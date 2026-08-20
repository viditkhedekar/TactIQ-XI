"use client";

import { useState, useTransition } from "react";
import { acceptJobAction } from "@/app/actions";
import { Button, ClubDot, Panel } from "@/components/ui/primitives";
import { ordinal } from "@/engine";

/**
 * The clubs willing to take on a sacked manager.
 *
 * Taking one is final and immediately changes who the save is about, so each
 * offer states the expectation attached to it up front: the point of the screen
 * is choosing which set of demands to live under next.
 */
export function JobOfferList({
  offers,
}: {
  offers: {
    id: number;
    clubId: number;
    clubName: string;
    primaryColor: string;
    expectedPosition: number;
    pitch: string;
  }[];
}) {
  const [pending, startTransition] = useTransition();
  const [taking, setTaking] = useState<number | null>(null);

  return (
    <Panel title={`${offers.length} ${offers.length === 1 ? "club wants" : "clubs want"} you`}>
      <div className="divide-y divide-[var(--border)]">
        {offers.map((offer) => (
          <div key={offer.id} className="flex items-start justify-between gap-4 px-3 py-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium">
                <ClubDot color={offer.primaryColor} />
                {offer.clubName}
              </p>
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">{offer.pitch}</p>
              <p className="mt-1 text-[11px] text-[var(--text-dim)]">
                They would want {ordinal(offer.expectedPosition)} or better.
              </p>
            </div>

            <Button
              variant="primary"
              size="sm"
              disabled={pending}
              onClick={() => {
                setTaking(offer.id);
                startTransition(async () => {
                  await acceptJobAction(offer.id);
                });
              }}
            >
              {pending && taking === offer.id ? "Signing..." : "Take the job"}
            </Button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
