"use client";

import { useLayoutEffect, useMemo } from "react";
import { capturePersonalDataPlane, type PersonalDataContext, type PersonalDataPlane } from "./personal-data-context";

/** Retire held callbacks on account, authority, parent or mount changes, including A→B→A. */
export function usePersonalDispatch(context: PersonalDataContext, parent?: PersonalDataPlane, resourceId?: string) {
  const key = JSON.stringify([context.state, context.userId, context.ownerId, context.tenant?.organizationId,
    Boolean(context.legacy), context.legacy?.organizationId, parent?.kind, parent?.userId, parent?.ownerId, parent?.organizationId, resourceId]);
  const lease = useMemo(() => ({ key, active: false, version: 0 }), [key]);
  useLayoutEffect(() => {
    lease.active = true;
    return () => { lease.active = false; lease.version++; };
  }, [lease]);
  return () => {
    const version = lease.version;
    const assertCurrent = () => {
      if (!lease.active || lease.version !== version) throw new Error("PERSONAL_CONTEXT_CHANGED");
    };
    assertCurrent();
    const plane = capturePersonalDataPlane(context, parent);
    return {
      plane,
      assertCurrent,
      dispatch: <Result,>(call: () => Promise<Result>) => {
        assertCurrent();
        return call().then(result => { assertCurrent(); return result; });
      },
    };
  };
}
