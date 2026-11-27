# Hamilton GL Review

Upload a Trailing Profit and Loss Detail Excel export and a GL heads Excel file, then select **Run review**. The dashboard opens on changed lines whose GL code appears in the GL heads list. **All P&L lines** includes report subtotals and net income where present. Clear **Changes only** to see unchanged lines. Use the month controls to compare any two months present in the report.

The Excel download includes selected GL changes, all changes, full P&L detail with every uploaded month, and a review notes sheet with the GL matching status. It includes the full review for the selected month pair, regardless of display filters.

## Input files

- **P&L export (.xlsx or .xlsm).** Use a report with an Account header and at least two monthly columns such as `Jan 2026 Actual`. Header position, report title, month order, number of months, and account codes come from the file. Use the same month-based P&L layout for other properties and date ranges.
- **GL heads (.xlsx or .xlsm).** Put account codes in column A or under a header such as GL Account. For codes with leading zeros, format them as text in both source files.
- The legacy dashboard workbook served as the workflow reference. The app does not require it at runtime. It can read a compatible PNL worksheet saved inside it without running macros.
- The review uses report exports. Individual invoice files and invoice PDF layouts are outside this workflow.

## Review rules

The default comparison is the latest actual month minus the previous available actual month. The export preserves the source report’s Adjusted Total and Variance separately. The tool treats blank monthly cells as zero activity. Invalid or uncached amounts leave the difference blank and are reported on-screen. Percent change is Difference divided by the absolute comparison amount, with no percentage shown when that amount is zero or unavailable.

## Deploy from GitHub to Vercel

1. Unzip the package and push its contents to a GitHub repository. Keep `public/` and `vercel.json` at the repository root. Source accounting workbooks are excluded.
2. In Vercel, select **Add New → Project** and import the repository.
3. Use the repository root. The included configuration sets `public` as the output directory and skips install and build. No environment variables are required.
4. Deploy and open the Vercel URL. Select the two Excel files and run the review.

All workbook parsing and Excel generation run in the browser. The app has no portal integration, server upload endpoint, database, or external asset calls.

## Run locally

From the project folder, run `python3 -m http.server 8080 --directory public` and open `http://localhost:8080`. Run the calculation tests with `npm test` (Node.js 20 or later).

The browser bundle includes fflate 0.8.2 under the MIT license. The license is in `public/vendor/fflate-LICENSE.txt`.
