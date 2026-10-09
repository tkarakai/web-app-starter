/** @deprecated Import app-operator guards from ./appOperatorAccess. */
export { requireAppOperator, isAppOperatorIdentity, appOperatorIdentity, requireAppOperatorTarget } from "./appOperatorAccess";
import { requireAppOperator, isAppOperatorIdentity, appOperatorIdentity, requireAppOperatorTarget } from "./appOperatorAccess";

/** @deprecated Use requireAppOperator. */
export const requireOperator = requireAppOperator;
/** @deprecated Use isAppOperatorIdentity. */
export const isOperatorIdentity = isAppOperatorIdentity;
/** @deprecated Use appOperatorIdentity. */
export const operatorIdentity = appOperatorIdentity;
/** @deprecated Use requireAppOperatorTarget. */
export const requireOperatorTarget = requireAppOperatorTarget;
