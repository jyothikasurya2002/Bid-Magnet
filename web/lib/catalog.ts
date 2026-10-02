export type CatalogueOption = {
  value: string;
  label: string;
  description?: string;
  group?: string;
};

export const REGIONS: CatalogueOption[] = [
  "Madrid",
  "Comunitat Valenciana",
  "Andalucía",
  "Cataluña",
  "País Vasco",
  "Galicia",
  "Canarias",
  "Illes Balears",
  "Castilla y León",
  "Castilla-La Mancha",
  "Aragón",
  "Murcia",
  "Asturias",
  "Extremadura",
  "Navarra",
  "Cantabria",
  "La Rioja",
  "Ceuta",
  "Melilla",
].map((region) => ({ value: region, label: region }));

export const CPV_OPTIONS: CatalogueOption[] = [
  {
    value: "72",
    label: "72 — Servicios TI",
    description: "Consultoría, desarrollo, Internet y soporte",
    group: "Servicios",
  },
  {
    value: "7221",
    label: "7221 — Programación de software",
    description: "Desarrollo de paquetes y productos",
    group: "Servicios",
  },
  {
    value: "7222",
    label: "7222 — Consultoría de sistemas",
    description: "Planificación y consultoría técnica",
    group: "Servicios",
  },
  {
    value: "7223",
    label: "7223 — Desarrollo de software personalizado",
    description: "Software a medida e integración",
    group: "Servicios",
  },
  {
    value: "7224",
    label: "7224 — Análisis y programación",
    description: "Diseño, análisis y programación",
    group: "Servicios",
  },
  {
    value: "7225",
    label: "7225 — Sistemas y apoyo",
    description: "Soporte, recuperación y continuidad",
    group: "Servicios",
  },
  {
    value: "7226",
    label: "7226 — Servicios relacionados con software",
    description: "Mantenimiento, implantación y formación",
    group: "Servicios",
  },
  {
    value: "7240",
    label: "7240 — Servicios de Internet",
    description: "Hosting, web y servicios de red",
    group: "Servicios",
  },
  {
    value: "7250",
    label: "7250 — Servicios informáticos",
    description: "Operación, conversión y catálogo",
    group: "Servicios",
  },
  {
    value: "7260",
    label: "7260 — Apoyo informático",
    description: "Asistencia técnica y consultoría",
    group: "Servicios",
  },
  {
    value: "48",
    label: "48 — Paquetes de software",
    description: "Licencias y productos de software",
    group: "Software",
  },
  {
    value: "302",
    label: "302 — Equipo informático",
    description: "Ordenadores, servidores y periféricos",
    group: "Hardware",
  },
  {
    value: "3242",
    label: "3242 — Equipo de red",
    description: "Routers, switches y redes",
    group: "Redes",
  },
  {
    value: "6421",
    label: "6421 — Telefonía y transmisión de datos",
    description: "Telecomunicaciones y conectividad",
    group: "Telecomunicaciones",
  },
];

export const CERTIFICATIONS: CatalogueOption[] = [
  { value: "ISO27001", label: "ISO/IEC 27001", description: "Seguridad de la información" },
  { value: "ISO9001", label: "ISO 9001", description: "Gestión de calidad" },
  { value: "ISO14001", label: "ISO 14001", description: "Gestión ambiental" },
  { value: "ISO45001", label: "ISO 45001", description: "Seguridad y salud laboral" },
  { value: "ISO20000_1", label: "ISO/IEC 20000-1", description: "Gestión de servicios TI" },
  { value: "ISO22301", label: "ISO 22301", description: "Continuidad de negocio" },
  { value: "ISO27701", label: "ISO/IEC 27701", description: "Gestión de privacidad" },
  { value: "ISO42001", label: "ISO/IEC 42001", description: "Gestión de inteligencia artificial" },
  { value: "ENS_BASICA", label: "ENS BÁSICA", description: "Declaración o certificación de conformidad" },
  { value: "ENS_MEDIA", label: "ENS MEDIA", description: "Certificación de conformidad" },
  { value: "ENS_ALTA", label: "ENS ALTA", description: "Certificación de conformidad" },
  { value: "CMMI", label: "CMMI", description: "Madurez de procesos de desarrollo" },
  { value: "SOC2", label: "SOC 2", description: "Informe de aseguramiento" },
  {
    value: "EN301549",
    label: "UNE-EN 301 549",
    description: "Accesibilidad de productos y servicios TIC",
  },
];

export const ROLECE_OPTIONS = [
  { value: "active", label: "Registered", description: "Active registration" },
  { value: "applied", label: "Application submitted", description: "Pending registration" },
  { value: "not_registered", label: "Not registered", description: "No registration or application" },
  { value: "unknown", label: "Unknown", description: "Needs checking" },
] as const;
