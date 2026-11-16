# Pet Expert ERP import and operational synchronization

## Setup / upgrade

Live inspection found five saved reports (555 source rows) but empty products, customers, sales_transactions and notifications tables. In the existing Supabase project, run `migrations/20261113_operational_bridge.sql` once in SQL Editor. The signed-in site owner can download it at `/api/operational-migration`. For a fresh database, `/api/import-migration` includes both migrations in order.

The version 2 migration backfills the already saved reports. No re-upload is necessary. In Data Import, click **Check database setup** to see live counts. **Sync saved reports** can repeat the operation without creating duplicates. Future uploads store source rows and synchronize operational records in a single database transaction.

## Resulting data flow

- `erp_reports` and `erp_report_rows` preserve every source row plus normalized fields, dates, and report metadata. Missing values remain null/empty. Identical content and metadata are deduplicated even if the filename changes. Revisions keep their source history.
- `products` receives exact normalized product names from stock, pricing and product-sales reports. A unique existing product name can retain its SKU. Other names receive internal `ERP-P-...` IDs labeled `sku_origin='generated'`. No fuzzy name matching is performed. `erp_product_map` records these links. Review links before treating internal codes as source SKUs.
- The latest stock snapshot supplies quantity, weighted average cost and earliest known expiry. The source Stock column called SKU contains quantity. The latest pricing snapshot supplies current selling price; historical sales averages do not become current prices. Unknown cost/price/quantity remain NULL.
- `customers` uses a supplied 13-digit tax ID when available. Other buyers receive a name-derived grouping ID labeled `identity_basis='name'`. These are customer groups rather than verified identities; same-name buyers need review.
- `sales_transactions` preserves invoice headers as `transaction_kind='invoice'`, with amounts and invoice number. Unknown SKU, units and sales channel remain NULL. Existing product-level records retain `transaction_kind='sales_line'`.
- `product_sales_summaries` aggregates product units and money by report period. The January–August total is not assigned to monthly_units_sold. The Executive dashboard uses invoice net sales in THB, a sales-month selector, and the actual product-sales report period for its chart.
- Fixed assets stay in their source report rather than becoming inventory products.
- `notifications` is populated by the existing Gemini expiry API when priced stock is inside the expiry window. Empty notifications can be correct. The bridge creates no placeholder recommendations and preserves existing statuses.

## Expected results for the supplied revised files

Source rows: stock 40, product sales 163, fixed assets 30, invoices 287, pricing 35.

Operational results tested locally: 186 customer groups, 220 products, 287 invoice transactions, 157 product sales summaries (some source product names repeat), and zero notifications.

## Verification

```sql
select 'customers' as table_name, count(*) as rows from public.customers
union all select 'products',count(*) from public.products
union all select 'sales_transactions',count(*) from public.sales_transactions
union all select 'notifications',count(*) from public.notifications;

select kind,file_name,row_count,metadata,imported_at
from public.erp_reports order by imported_at desc;
```

RLS remains enabled. New mapping and summary tables have no browser-role grants or open policies. Only the service role can execute the import/synchronization RPCs; the Worker verifies the site owner first. The migration changes unknown-value columns to allow NULL and adds invoice fields; it does not delete saved reports, profiles or notifications.

## Tests

Run `npm run build`, then `node tests/erp-import.integration.mjs` with `PGLITE_MODULE` pointing to a temporary @electric-sql/pglite `dist/index.js` and `ERP_FIXTURE_ROOT` containing the revised workbooks named `stock.xlsx`, `sales_by_product.xlsx`, `fixed_assets.xlsx`, `simple_sales.xlsx`, and `pricing.xlsx`. Tests cover import rollback, deduplication, an existing schema with enum notification fields, backfill, reruns, role permissions, API status and sync, unknown values, and dashboard date/amount handling. Business-data fixtures must not be committed.
