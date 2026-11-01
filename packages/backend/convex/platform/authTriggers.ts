/**
 * Better Auth component triggers. The component calls these inside the transaction of each
 * write, so a trigger that throws rolls the write back. Configured in `auth.ts`.
 */
import { authComponent } from "./auth";

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();
