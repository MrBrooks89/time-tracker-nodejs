"use client";

import { useRouter } from "next/navigation";

import { Select } from "@/components/ui/select";

interface PartnerOption {
  id: string;
  name: string;
}

// Admin-only delegated entry navigation (TS-021): pick a partner to open
// their week. Empty value returns to the admin's own week.
export function PartnerSelect({
  partners,
  selectedId,
  weekStartDate,
}: {
  partners: PartnerOption[];
  selectedId: string | null;
  weekStartDate: string;
}) {
  const router = useRouter();

  function handleChange(value: string) {
    const target = value
      ? `/week?week=${encodeURIComponent(weekStartDate)}&user=${encodeURIComponent(value)}`
      : `/week?week=${encodeURIComponent(weekStartDate)}`;
    router.push(target);
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="micro-label" htmlFor="partner-select">
        Partner / Delegated entry
      </label>
      <Select
        id="partner-select"
        aria-label="Open week for partner"
        value={selectedId ?? ""}
        onChange={(e) => handleChange(e.target.value)}
      >
        <option value="">My own week</option>
        {partners.map((partner) => (
          <option key={partner.id} value={partner.id}>
            {partner.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
