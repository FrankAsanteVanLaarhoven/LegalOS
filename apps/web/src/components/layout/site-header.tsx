import { capabilityBadges } from "@/lib/capabilities";
import { Navbar } from "@/components/layout/navbar";

/**
 * Server wrapper for the header.
 *
 * Capability status is measured server-side and handed to the navigation, so
 * the menu can mark unbuilt work as planned without any client code asserting
 * a status of its own.
 */
export async function SiteHeader() {
  return <Navbar capabilityStatuses={await capabilityBadges()} />;
}
