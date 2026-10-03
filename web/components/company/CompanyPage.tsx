"use client";

import { useState } from "react";
import type { CompanyDocument, CompanyProfile } from "@/lib/types";
import { CompanyLedger } from "./CompanyLedger";
import { CompanyStart } from "./CompanyStart";

type CompanyPageProps = {
  initialCompany: CompanyProfile | null;
  initialDocuments: CompanyDocument[];
  userId: string;
};

export function CompanyPage({ initialCompany, initialDocuments, userId }: CompanyPageProps) {
  const [company, setCompany] = useState(initialCompany);
  const [importOnLoad, setImportOnLoad] = useState(false);

  if (!company) {
    return (
      <CompanyStart
        onCreated={(created, importWebsite) => {
          setImportOnLoad(importWebsite);
          setCompany(created);
        }}
      />
    );
  }

  return (
    <CompanyLedger
      initialCompany={company}
      initialDocuments={initialDocuments}
      userId={userId}
      importOnLoad={importOnLoad}
    />
  );
}
