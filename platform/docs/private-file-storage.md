# Private files in the reference app

The sample file feature binds ownership when an authenticated upload action stores the bytes.
A storage ID alone is never permission to attach, read, or delete an object. This is app-owned
sample code: adopting apps must port these changes to their own file feature when upgrading.

## Upload, read and delete

Call `api.files.uploadFile({ projectId, name, contentType, bytes })`, where `bytes` is the
file's `ArrayBuffer`. The server checks the authenticated caller and project, enforces the
1 MiB size and content-type allowlist, stores the bytes itself, then records immutable ownership.
It checks authorization again before finalizing. Failed finalization cleans up only the newly
created, unattached object; a committed attachment is preserved if its response was lost.

`generateUploadUrl` and `saveUpload` reject calls. Deploy the backend and updated file UI
together. An old upload URL may still accept bytes until it expires, but its storage ID cannot
be registered through a public API. Do not restore a client-selected storage-ID path to support
an old client. Retire old upload URLs and reconcile their orphan objects separately.

`listUploads` returns display metadata and `available`, with no storage URL or storage ID.
`downloadFile({ id })` authenticates and checks the project and exclusive file ownership each
time, returning bytes for a local browser download. A ban or revoked project access prevents
subsequent downloads. A recipient can retain bytes already downloaded; revocation cannot erase
those copies. The server does not issue bearer storage URLs for new files.

Direct file deletion and project cascade deletion require the same ownership proof. A duplicate
reference or an upload without trusted provenance blocks the entire deletion transaction, so
neither another owner's file nor part of a project's records are lost.

## Existing deployments

The optional `uploads.ownershipVersion` field preserves schema compatibility. Only the new
server upload path sets it to `1`. **Do not backfill it from existing `ownerId` values:** the old
registration API allowed arbitrary storage IDs, so a legacy row cannot prove who supplied the
bytes. Legacy uploads are unavailable to application downloads and cannot be deleted by users
or project cascades until an operator reconciles them. New uploads continue to work.

Before removing or migrating any legacy bytes:

1. Back up the database and storage, and retain an operator audit of the reconciliation.
2. Run the read-only internal inventory on the intended deployment:
   `bunx convex run files:inventoryLegacyUploads '{"paginationOpts":{"numItems":100,"cursor":null}}'`.
   Repeat with the returned `continueCursor` until `isDone` is true. The inventory includes
   storage IDs, every reference up to the stated truncation limit, claimed owners and actual
   project owners. If `referencesTruncated` is true, inspect the full `by_storage` index before
   acting. Do not rely on one page as a complete inventory.
3. Reconcile ownership against trusted upload records, backups or the original owner. Treat
   cross-owner references, mismatched project owners and uncertain provenance as quarantined;
   never decide by oldest row, claimed owner, or first claimant.
4. Have the verified owner upload the original bytes through the new authenticated flow. Confirm
   their download and content hash, then remove reviewed legacy attachment rows using the
   deployment's operator tools. Do not change `ownershipVersion` to bypass verification.
5. Recheck **all** references to each old storage ID. Only after resolving every reference and
   preserving the verified owner's replacement should the operator delete the old storage
   object. Record the IDs and outcome. No automatic data migration or byte deletion runs on deploy.

Previously issued Convex storage URLs remain bearer URLs until their old object is deleted.
Quarantine stops application access and destructive operations but does not revoke an already
shared URL. Copying to a new object and retiring the old one after reconciliation is necessary
when confidentiality requires URL revocation. See [Convex storage security](https://docs.convex.dev/file-storage/overview#security-model).

## Porting the fix into an adopted app

Port `files.ts`, `fileAccess.ts`, the guarded upload cascade in `projects.ts`, the optional
ownership field and `by_storage` index in `sampleTables.ts`, and the file panel's authenticated
action calls. Keep the app's own tables, permissions and UI. The platform auth helper is exported
from `platform/functions.ts`; both upload finalization and download checks use it.

Apps with sharing need an explicit authorization/refcount model before adding aliases. Keep
one immutable object owner, authorize all readers, and delete bytes only after authorized final
reference removal. Do not replace ownership checks with a caller-supplied owner or an upload
intent that accepts an arbitrary storage ID.
