import { partnerCards, type PartnerCandidate } from "@/lib/partners";

// "Bid with a partner": companies that won contracts most similar to this one. Teaming up
// (UTE or subcontracting) covers experience, certificates or capacity the company lacks.
export function PartnersPanel({ partners, gaps }: { partners: PartnerCandidate[]; gaps: number }) {
  const cards = partnerCards(partners);
  return (
    <section className="dec-panel dec-partners">
      <h2 className="dec-label">
        Bid with a partner
        {gaps ? (
          <span className="dec-label-aside">
            {gaps} gap{gaps === 1 ? "" : "s"} in your fit: a partner can cover them
          </span>
        ) : null}
      </h2>
      {cards.length ? (
        <>
          <ul className="dec-partner-list">
            {cards.map((card) => (
              <li key={card.key} className="dec-partner">
                <span className="dec-partner-name">{card.name}</span>
                {card.tags.length ? (
                  <span className="dec-partner-tags">
                    {card.tags.map((tag) => (
                      <span key={tag} className="dec-partner-tag">
                        {tag}
                      </span>
                    ))}
                  </span>
                ) : null}
                <span className="dec-partner-detail">{card.detail}</span>
                {card.example ? (
                  <span className="dec-partner-example" lang="es" title={card.example.title}>
                    e.g. {card.example.title}
                    {card.example.buyer ? ` · ${card.example.buyer}` : ""}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="dec-foot">
            Companies that won the contracts most similar to this one, nearby first. Suggestions to contact, not
            endorsements: some may also bid against you.
          </p>
        </>
      ) : (
        <p className="dec-muted">No companies have won contracts like this one in our data yet.</p>
      )}
    </section>
  );
}
