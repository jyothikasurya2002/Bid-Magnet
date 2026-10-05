import { describe, expect, it } from "vitest";
import { quoteOnPage, urlKey } from "./research";

describe("research checks", () => {
  it("matches a quote despite accents, case and spacing", () => {
    const page = "Aviso legal. BITÁCORA SOFTWARE, S.L., con CIF B47318820 y domicilio en Valladolid.";
    expect(quoteOnPage("Bitacora Software, S.L., con CIF B47318820", page)).toBe(true);
    expect(quoteOnPage("Bitácora Software, S.A., con CIF B12345678", page)).toBe(false);
    expect(quoteOnPage("", page)).toBe(false);
  });

  it("treats the same page with tracking or www as one source", () => {
    expect(urlKey("https://www.bitacora.es/empresa/?utm_source=x#equipo")).toBe(
      urlKey("https://bitacora.es/empresa"),
    );
    expect(urlKey("not a url")).toBeNull();
  });
});
