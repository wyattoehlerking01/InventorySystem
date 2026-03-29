# Teacher User Guide

This guide explains how teachers use the management console to run inventory operations, manage users/classes, and review activity.

## 1. What This Guide Covers

Use this guide to:
- Sign in to management mode
- Manage users and classes
- Manage inventory and visibility
- Oversee projects and requests
- Review activity logs
- Apply role and security guardrails

## 2. Where To Access The App

Teacher workflows run from the management path:
- `/manage/`

Important:
- Students are blocked from this view.
- Student login attempts in manage mode show: "Management console access is restricted to teachers and developers."

## 3. Sign-In And First-Time Access

1. Open `/manage/`.
2. Enter your username.
3. Enter your authentication password.
4. Select `Sign In`.

Common login messages:
- Missing fields: "Enter your username and authentication password."
- Invalid credentials: "Invalid username or password."
- Too many attempts: "Too many login attempts. Locked for 60 seconds."

If no authentication password is set:
- Sign in with your assigned process, then use your sidebar profile area to set/change your authentication password when prompted.

## 4. Main Navigation Overview

Typical teacher navigation includes:
- `Dashboard`
- `Inventory`
- `Projects`
- `Operations Hub`
- `Activity Log`
- `Classes`
- `Users`

What each area is for:
- `Dashboard`: health summary, low stock, activity snapshots
- `Inventory`: item records, stock, categories/tags, bulk actions
- `Projects`: create/manage active project checkouts
- `Operations Hub`: orders/requests/system operations
- `Activity Log`: searchable audit history
- `Classes`: permission and visibility policy by class
- `Users`: account lifecycle and role assignment

## 5. Users Management

Use `Users` to create and maintain accounts.

Core actions:
1. Add new users with required identity fields.
2. Assign role (`student`, `teacher`, or `developer` where permitted).
3. Suspend/reactivate users as needed.
4. Edit user details (including barcode where your permissions allow).
5. Delete single users or use bulk delete for cleanup.

Best practices:
- Suspend instead of deleting when you may need history continuity.
- Confirm class membership after user creation.

## 6. Classes Management

Use `Classes` to control access and behavior.

For each class, configure:
- Student roster membership
- Default permissions:
- `canSignOut`
- `canCreateProjects`
- `canJoinProjects`
- Allowed visibility tags for inventory filtering
- Due policy settings used for checkout deadlines

Notes:
- Class settings directly affect what students can see and do.
- Students in multiple classes can receive a merged (most permissive) permission outcome.

## 7. Inventory Management

Use `Inventory` for catalog and stock operations.

Core tasks:
1. Search items by name/SKU/category.
2. Add or edit items.
3. Maintain categories and visibility tags.
4. Use bulk import or bulk tag/category tools when available.
5. Track stock status and out-of-stock risks.

Operational reminders:
- Student visibility depends on class rules and item tagging.
- Keep SKU/location/description metadata complete for better auditing and student use.

## 8. Checkout And Returns Oversight

Teachers can perform checkout workflows similarly to kiosk operations, including basket-based checkout.

Typical flow:
1. Add items to basket.
2. Choose destination (`My Items (Personal)` or a project).
3. Complete `Bulk Checkout`.
4. Process returns/sign-in when items come back.

If hardware unlock is enabled:
- Checkout/return can be blocked when unlock is denied.
- Resolve hardware/access issues before retrying.

## 9. Projects Management

Use `Projects` to coordinate shared work and item ownership.

Core tasks:
- Create new projects
- Assign collaborators
- Track active checked-out items
- Archive/complete projects when work ends
- Delete non-personal projects (with caution when items are still assigned)

Best practice:
- Ensure all items are signed in or reassigned before deleting a project.

## 10. Operations Hub (Orders/Requests/System)

Use `Operations Hub` to process operational workflows such as order requests.

Typical actions:
- Review incoming requests
- Approve or deny with clear rationale
- Monitor request status to completion

If student order visibility is disabled:
- Students may not see orders views even if requests are submitted.

## 11. Activity Log And Auditing

Use `Activity Log` for traceability and incident review.

Recommended process:
1. Filter by action type.
2. Confirm actor, item, project, quantity, and timestamp.
3. Use logs to verify disputed sign-outs/returns.

## 12. Role Guardrails And Security

Keep these guardrails in mind:
- Management console is teacher/developer only.
- Developer assignment is restricted by policy controls.
- Authentication password flows are identity-gated and should remain private.
- Shared kiosk devices must be signed out when unattended.

## 13. Troubleshooting

### Login succeeds but dashboard does not load
- Refresh and retry.
- Confirm data scripts and backend connectivity are healthy.

### Users cannot access expected pages
- Re-check role assignment and class permissions.
- Confirm account is not suspended.

### Student cannot check out item
- Verify class `canSignOut` permission.
- Verify item visibility tags and class access level.
- Verify stock is greater than zero.

### Request actions fail
- Retry after refresh.
- Confirm database connectivity and permission policies.

## 14. Quick Daily Checklist

Start of day:
- Confirm critical stock levels
- Review pending requests
- Check for suspended/locked-out account issues

End of day:
- Review overdue/active checkouts
- Resolve returns that did not complete
- Sign out of management console
