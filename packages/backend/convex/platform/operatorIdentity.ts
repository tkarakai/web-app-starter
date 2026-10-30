/** @deprecated Import app-operator identity helpers from ./appOperatorIdentity. */
export { isAppOperatorIdentity, appOperatorIdentity, requireAppOperatorTarget } from "./appOperatorIdentity";
import { isAppOperatorIdentity, appOperatorIdentity, requireAppOperatorTarget } from "./appOperatorIdentity";

/** @deprecated Use isAppOperatorIdentity. */
export const isOperatorIdentity = isAppOperatorIdentity;
/** @deprecated Use appOperatorIdentity. */
export const operatorIdentity = appOperatorIdentity;
/** @deprecated Use requireAppOperatorTarget. */
export const requireOperatorTarget = requireAppOperatorTarget;
