"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/primitives";
import {
  acceptCounterAction,
  respondToOfferAction,
  withdrawOfferAction,
} from "@/app/actions";

/** Buttons on the manager's own outstanding bids. */
export function OutgoingOfferActions({
  offerId,
  status,
}: {
  offerId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(work: () => Promise<{ error?: string } | null>) {
    startTransition(async () => {
      const result = await work();
      if (result?.error) setError(result.error);
      router.refresh();
    });
  }

  if (status === "countered") {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => run(() => acceptCounterAction(offerId))}
          >
            Meet it
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => run(() => withdrawOfferAction(offerId))}
          >
            Walk away
          </Button>
        </div>
        {error && <span className="text-[10px] text-[var(--bad)]">{error}</span>}
      </div>
    );
  }

  if (status === "pending") {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(() => withdrawOfferAction(offerId))}
      >
        Withdraw
      </Button>
    );
  }

  return null;
}

/** Buttons on a bid another club has made for one of the manager's players. */
export function IncomingOfferActions({ offerId }: { offerId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function respond(accept: boolean) {
    startTransition(async () => {
      const result = await respondToOfferAction(offerId, accept);
      if (result?.error) setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <Button size="sm" variant="primary" disabled={pending} onClick={() => respond(true)}>
          Accept
        </Button>
        <Button size="sm" variant="danger" disabled={pending} onClick={() => respond(false)}>
          Reject
        </Button>
      </div>
      {error && <span className="text-[10px] text-[var(--bad)]">{error}</span>}
    </div>
  );
}
