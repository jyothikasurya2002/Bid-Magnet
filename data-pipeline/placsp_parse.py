"""Parse PLACSP Atom/CODICE XML into flat records.

One Atom <entry> = one version of a tender ("contract folder"). The same tender
appears many times across a month as it moves PUB -> EV -> ADJ -> RES, so callers
must keep only the newest version per tender (see `latest_versions`).

Each parsed tender is a dict with nested lists:
    criteria      award criteria + weights (folder level and per lot)
    documents     PCAP / PPT / other PDFs and notice documents, with URLs
    results       award results (winner, bidder count, lowest/highest bid)
    requirements  qualification / solvency / classification requirements
    lots          lot id, name, budget, CPVs
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Iterable, Iterator
from xml.etree import ElementTree as ET

NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "cbc": "urn:dgpe:names:draft:codice:schema:xsd:CommonBasicComponents-2",
    "cac": "urn:dgpe:names:draft:codice:schema:xsd:CommonAggregateComponents-2",
    "cpe": "urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonAggregateComponents-2",
    "cbe": "urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonBasicComponents-2",
    "at": "http://purl.org/atompub/tombstones/1.0",
}
ENTRY = f"{{{NS['atom']}}}entry"
DELETED = f"{{{NS['at']}}}deleted-entry"

# Code lists (subset). Raw codes are always kept alongside the label.
STATUS = {
    "PRE": "Anuncio previo", "PUB": "En plazo", "EV": "Pendiente de adjudicación",
    "ADJ": "Adjudicada", "RES": "Resuelta", "ANUL": "Anulada",
}
CONTRACT_TYPE = {
    "1": "Suministros", "2": "Servicios", "3": "Obras", "21": "Gestión de servicios públicos",
    "22": "Concesión de servicios", "31": "Concesión de obras públicas", "32": "Concesión de obras",
    "40": "Colaboración público-privada", "7": "Administrativo especial", "8": "Privado", "50": "Patrimonial",
}
PROCEDURE = {
    "1": "Abierto", "2": "Restringido", "3": "Negociado sin publicidad", "4": "Negociado con publicidad",
    "5": "Diálogo competitivo", "6": "Normas internas", "7": "Derivado de acuerdo marco",
    "8": "Concurso de proyectos", "9": "Abierto simplificado", "10": "Asociación para la innovación",
    "11": "Derivado de asociación para la innovación", "12": "Basado en sistema dinámico de adquisición",
    "13": "Licitación con negociación", "100": "Otros",
}

# IT sector filter on CPV codes. "core" = software & IT services, which is our target.
IT_CPV_PREFIXES = {
    "core": ("72", "48"),
    "hardware": ("302",),
    "telecom_network": ("3242", "6421"),
}


def it_segment(cpvs: Iterable[str]) -> str | None:
    """Return 'core', 'hardware', 'telecom_network' or None for a list of CPV codes."""
    cpvs = list(cpvs)
    for segment, prefixes in IT_CPV_PREFIXES.items():
        if any(c.startswith(prefixes) for c in cpvs):
            return segment
    return None


# --------------------------------------------------------------------------- helpers

def _text(el: ET.Element | None, path: str | None = None) -> str | None:
    if el is None:
        return None
    node = el.find(path, NS) if path else el
    if node is None or node.text is None:
        return None
    return " ".join(node.text.split()) or None


def _num(el: ET.Element | None, path: str) -> float | None:
    v = _text(el, path)
    try:
        return float(v) if v is not None else None
    except ValueError:
        return None


def _int(el: ET.Element | None, path: str) -> int | None:
    v = _num(el, path)
    return int(v) if v is not None else None


def _party_id(party: ET.Element | None, scheme: str) -> str | None:
    if party is None:
        return None
    for pid in party.findall("cac:PartyIdentification/cbc:ID", NS):
        if pid.get("schemeName") == scheme:
            return (pid.text or "").strip() or None
    return None


def _criteria(terms_parent: ET.Element | None, lot_id: str | None) -> list[dict]:
    out = []
    if terms_parent is None:
        return out
    for c in terms_parent.findall("cac:TenderingTerms/cac:AwardingTerms/cac:AwardingCriteria", NS):
        out.append({
            "lot_id": lot_id,
            "type": _text(c, "cbc:AwardingCriteriaTypeCode"),      # OBJ = formula, SUBJ = judgement
            "subtype": _text(c, "cbc:AwardingCriteriaSubTypeCode"),  # 1 = price
            "description": _text(c, "cbc:Description"),
            "note": _text(c, "cbc:Note"),
            "weight": _num(c, "cbc:WeightNumeric"),
        })
    return out


def _requirements(terms_parent: ET.Element | None, lot_id: str | None) -> list[dict]:
    out = []
    if terms_parent is None:
        return out
    q = terms_parent.find("cac:TenderingTerms/cac:TendererQualificationRequest", NS)
    if q is None:
        return out
    for r in q.findall("cac:SpecificTendererRequirement", NS):
        out.append({"lot_id": lot_id, "kind": "declaration", "code": _text(r, "cbc:RequirementTypeCode"),
                    "description": _text(r, "cbc:Description"), "threshold": None})
    for tag, kind in (("cac:TechnicalEvaluationCriteria", "technical_solvency"),
                      ("cac:FinancialEvaluationCriteria", "financial_solvency")):
        for r in q.findall(tag, NS):
            out.append({"lot_id": lot_id, "kind": kind, "code": _text(r, "cbc:EvaluationCriteriaTypeCode"),
                        "description": _text(r, "cbc:Description"), "threshold": _num(r, "cbc:ThresholdQuantity")})
    for r in q.findall("cac:RequiredBusinessClassificationScheme/cac:ClassificationCategory", NS):
        out.append({"lot_id": lot_id, "kind": "classification", "code": _text(r, "cbc:CodeValue"),
                    "description": _text(r, "cbc:Description"), "threshold": None})
    return out


def _doc_ref(ref: ET.Element, kind: str) -> dict:
    return {
        "kind": kind,
        "name": _text(ref, "cbc:ID") or _text(ref, "cac:Attachment/cac:ExternalReference/cbc:FileName"),
        "doc_type": _text(ref, "cbc:DocumentTypeCode"),
        "url": _text(ref, "cac:Attachment/cac:ExternalReference/cbc:URI"),
        "hash": _text(ref, "cac:Attachment/cac:ExternalReference/cbc:DocumentHash"),
        "issue_date": _text(ref, "cbc:IssueDate"),
    }


def _documents(cfs: ET.Element) -> list[dict]:
    docs = []
    for path, kind in (("cac:LegalDocumentReference", "pcap"),          # administrative terms
                       ("cac:TechnicalDocumentReference", "ppt"),       # technical specs
                       ("cac:AdditionalDocumentReference", "additional"),
                       ("cpe:GeneralDocument/cpe:GeneralDocumentDocumentReference", "general")):
        for ref in cfs.findall(path, NS):
            docs.append(_doc_ref(ref, kind))
    # Notices (anuncio de licitación, adjudicación, formalización...) and their PDFs
    for notice in cfs.findall("cpe:ValidNoticeInfo", NS):
        notice_type = _text(notice, "cbe:NoticeTypeCode")
        for pub in notice.findall("cpe:AdditionalPublicationStatus", NS):
            for ref in pub.findall("cpe:AdditionalPublicationDocumentReference", NS):
                d = _doc_ref(ref, "notice")
                d["notice_type"] = notice_type
                d["media"] = _text(pub, "cbe:PublicationMediaName")
                if d["url"] or d["doc_type"]:
                    docs.append(d)
    return [d for d in docs if d.get("url")]


def _results(cfs: ET.Element) -> list[dict]:
    out = []
    for r in cfs.findall("cac:TenderResult", NS):
        winner = r.find("cac:WinningParty", NS)
        awarded = r.find("cac:AwardedTenderedProject", NS)
        out.append({
            "lot_id": _text(awarded, "cbc:ProcurementProjectLotID"),
            "result_code": _text(r, "cbc:ResultCode"),
            "description": _text(r, "cbc:Description"),
            "award_date": _text(r, "cbc:AwardDate"),
            "start_date": _text(r, "cbc:StartDate"),
            "received_tenders": _int(r, "cbc:ReceivedTenderQuantity"),
            "sme_received_tenders": _int(r, "cbc:SMEsReceivedTenderQuantity"),
            "lowest_bid": _num(r, "cbc:LowerTenderAmount"),
            "highest_bid": _num(r, "cbc:HigherTenderAmount"),
            "abnormally_low_excluded": _text(r, "cbc:AbnormallyLowTendersIndicator"),
            "sme_awarded": _text(r, "cbc:SMEAwardedIndicator"),
            "winner_nif": _party_id(winner, "NIF"),
            "winner_name": _text(winner, "cac:PartyName/cbc:Name"),
            "award_amount_no_tax": _num(awarded, "cac:LegalMonetaryTotal/cbc:TaxExclusiveAmount"),
            "award_amount_with_tax": _num(awarded, "cac:LegalMonetaryTotal/cbc:PayableAmount"),
            "contract_id": _text(r, "cac:Contract/cbc:ID"),
            "contract_date": _text(r, "cac:Contract/cbc:IssueDate"),
        })
    return out


def _lots(cfs: ET.Element) -> list[dict]:
    out = []
    for lot in cfs.findall("cac:ProcurementProjectLot", NS):
        pp = lot.find("cac:ProcurementProject", NS)
        out.append({
            "lot_id": _text(lot, "cbc:ID"),
            "name": _text(pp, "cbc:Name"),
            "budget_no_tax": _num(pp, "cac:BudgetAmount/cbc:TaxExclusiveAmount"),
            "budget_with_tax": _num(pp, "cac:BudgetAmount/cbc:TotalAmount"),
            "cpv_codes": [c.text.strip() for c in pp.findall(
                "cac:RequiredCommodityClassification/cbc:ItemClassificationCode", NS) if c.text] if pp is not None else [],
        })
    return out


def _buyer_hierarchy(lcp: ET.Element | None) -> list[str]:
    """Top-down list, e.g. ['Sector Público', 'ENTIDADES LOCALES', 'Comunidad Valenciana', ...]."""
    names = []
    node = lcp.find("cpe:ParentLocatedParty", NS) if lcp is not None else None
    while node is not None:
        n = _text(node, "cac:PartyName/cbc:Name")
        if n:
            names.append(n)
        node = node.find("cpe:ParentLocatedParty", NS)
    return list(reversed(names))


# --------------------------------------------------------------------------- entry

def parse_entry(entry: ET.Element) -> dict | None:
    cfs = entry.find("cpe:ContractFolderStatus", NS)
    if cfs is None:
        return None
    entry_url = _text(entry, "atom:id") or ""
    lcp = cfs.find("cpe:LocatedContractingParty", NS)
    party = lcp.find("cac:Party", NS) if lcp is not None else None
    pp = cfs.find("cac:ProcurementProject", NS)
    tp = cfs.find("cac:TenderingProcess", NS)
    link = entry.find("atom:link", NS)

    all_cpvs = sorted({c.text.strip() for c in cfs.iter(f"{{{NS['cbc']}}}ItemClassificationCode") if c.text})
    status = _text(cfs, "cbe:ContractFolderStatusCode")
    ctype = _text(pp, "cbc:TypeCode")
    proc = _text(tp, "cbc:ProcedureCode")

    criteria = _criteria(cfs, None)
    requirements = _requirements(cfs, None)
    for lot in cfs.findall("cac:ProcurementProjectLot", NS):
        lot_id = _text(lot, "cbc:ID")
        criteria += _criteria(lot, lot_id)
        requirements += _requirements(lot, lot_id)

    return {
        "id": entry_url.rsplit("/", 1)[-1],
        "entry_url": entry_url,
        "folder_id": _text(cfs, "cbc:ContractFolderID"),
        "title": _text(entry, "atom:title"),
        "link": link.get("href") if link is not None else None,
        "updated": _text(entry, "atom:updated"),
        "status": status,
        "status_label": STATUS.get(status or ""),
        "buyer_name": _text(party, "cac:PartyName/cbc:Name"),
        "buyer_nif": _party_id(party, "NIF"),
        "buyer_dir3": _party_id(party, "DIR3"),
        "buyer_city": _text(party, "cac:PostalAddress/cbc:CityName"),
        "buyer_type_code": _text(lcp, "cbc:ContractingPartyTypeCode"),
        "buyer_hierarchy": _buyer_hierarchy(lcp),
        "buyer_profile_url": _text(lcp, "cbc:BuyerProfileURIID"),
        "contract_type": ctype,
        "contract_type_label": CONTRACT_TYPE.get(ctype or ""),
        "contract_subtype": _text(pp, "cbc:SubTypeCode"),
        "budget_no_tax": _num(pp, "cac:BudgetAmount/cbc:TaxExclusiveAmount"),
        "budget_with_tax": _num(pp, "cac:BudgetAmount/cbc:TotalAmount"),
        "estimated_value": _num(pp, "cac:BudgetAmount/cbc:EstimatedOverallContractAmount"),
        "cpv_codes": all_cpvs,
        "it_segment": it_segment(all_cpvs),
        "nuts_code": _text(pp, "cac:RealizedLocation/cbc:CountrySubentityCode"),
        "location": _text(pp, "cac:RealizedLocation/cbc:CountrySubentity"),
        "duration": _num(pp, "cac:PlannedPeriod/cbc:DurationMeasure"),
        "duration_unit": (pp.find("cac:PlannedPeriod/cbc:DurationMeasure", NS).get("unitCode")
                          if pp is not None and pp.find("cac:PlannedPeriod/cbc:DurationMeasure", NS) is not None else None),
        "period_start": _text(pp, "cac:PlannedPeriod/cbc:StartDate"),
        "period_end": _text(pp, "cac:PlannedPeriod/cbc:EndDate"),
        "procedure_code": proc,
        "procedure_label": PROCEDURE.get(proc or ""),
        "urgency_code": _text(tp, "cbc:UrgencyCode"),
        "submission_method": _text(tp, "cbc:SubmissionMethodCode"),
        "over_eu_threshold": _text(tp, "cbc:OverThresholdIndicator"),
        "deadline_date": _text(tp, "cac:TenderSubmissionDeadlinePeriod/cbc:EndDate"),
        "deadline_time": _text(tp, "cac:TenderSubmissionDeadlinePeriod/cbc:EndTime"),
        "has_lots": bool(cfs.findall("cac:ProcurementProjectLot", NS)),
        "lots": _lots(cfs),
        "criteria": criteria,
        "requirements": requirements,
        "documents": _documents(cfs),
        "results": _results(cfs),
        "summary": _text(entry, "atom:summary"),
    }


def iter_atom(source: bytes | str | Path | io.IOBase) -> Iterator[dict]:
    """Stream-parse one Atom file. Yields tender dicts and {'deleted': id, 'when': ts} tombstones."""
    if isinstance(source, bytes):
        source = io.BytesIO(source)
    for _, el in ET.iterparse(source, events=("end",)):
        if el.tag == ENTRY:
            rec = parse_entry(el)
            if rec:
                yield rec
            el.clear()
        elif el.tag == DELETED:
            ref = el.get("ref") or ""
            yield {"deleted": ref.rsplit("/", 1)[-1], "when": el.get("when")}
            el.clear()


def iter_zip(path: str | Path) -> Iterator[dict]:
    """Iterate every .atom file inside a PLACSP monthly/annual zip."""
    with zipfile.ZipFile(path) as zf:
        for name in sorted(n for n in zf.namelist() if n.endswith(".atom")):
            with zf.open(name) as fh:
                yield from iter_atom(fh)


def iter_source(path: str | Path) -> Iterator[dict]:
    path = Path(path)
    if path.suffix == ".zip":
        return iter_zip(path)
    if path.is_dir():
        return (r for p in sorted(path.glob("*.atom")) for r in iter_atom(p))
    return iter_atom(path)


def latest_versions(records: Iterable[dict]) -> tuple[dict[str, dict], set[str]]:
    """Keep the newest version of each tender; collect tombstoned ids."""
    latest: dict[str, dict] = {}
    deleted: dict[str, str] = {}
    for r in records:
        if "deleted" in r:
            deleted[r["deleted"]] = r.get("when") or ""
            continue
        cur = latest.get(r["id"])
        if cur is None or (r["updated"] or "") > (cur["updated"] or ""):
            latest[r["id"]] = r
    # A tombstone only wins if it is newer than the last version we saw
    gone = {i for i, when in deleted.items() if i in latest and when >= (latest[i]["updated"] or "")}
    for i in gone:
        latest.pop(i)
    return latest, gone
