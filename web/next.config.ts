import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs loads its worker file from its own folder at runtime; bundling breaks that path.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
