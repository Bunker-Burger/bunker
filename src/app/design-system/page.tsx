import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DesignSystemShowcase } from "@/components/design-system/showcase";

export const metadata: Metadata = {
  title: "Sistema visual | Búnker Burger",
  robots: { index: false, follow: false }
};

// Internal reference page: available locally and on previews, never on the production deployment.
export default function DesignSystemPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <DesignSystemShowcase />;
}
