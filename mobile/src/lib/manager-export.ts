/**
 * Farmstand Manager Export Utilities
 * Handles PDF and CSV export for the Farmstand Manager module.
 * Uses expo-print, expo-sharing, expo-file-system.
 * ISOLATED — does not touch any existing claim/listing/messaging flows.
 */

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import type { FarmstandReportData, InventoryItem } from './manager-types';
import { DATE_RANGE_LABELS } from './manager-types';
import { formatCurrency, formatRelativeDate } from './manager-service';

// ============================================================
// PDF EXPORT
// ============================================================

export function buildPdfHtml(
  report: FarmstandReportData,
  inventory: InventoryItem[]
): string {
  const dateLabel = DATE_RANGE_LABELS[report.dateRange.preset];
  const generatedDate = new Date(report.generatedAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const generatedTime = new Date(report.generatedAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const netProfitColor = report.summary.netProfit >= 0 ? '#2D5A3D' : '#DC2626';
  const netProfitBg = report.summary.netProfit >= 0 ? '#F0FDF4' : '#FEF2F2';

  // Top Sellers rows
  const topSellersRows = report.topSellingItems.slice(0, 5).map((item, i) => `
    <tr>
      <td class="rank">${i + 1}</td>
      <td class="item-name">${escapeHtml(item.item_name)}</td>
      <td class="qty">${item.totalQuantity}</td>
      <td class="amount">${formatCurrency(item.totalRevenue)}</td>
    </tr>
  `).join('');

  const topSellersSection = report.topSellingItems.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <span class="section-icon">⭐</span>
        <h2 class="section-title">Top Selling Items</h2>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:40px">#</th>
            <th>Item</th>
            <th style="width:80px; text-align:center">Qty Sold</th>
            <th style="width:100px; text-align:right">Revenue</th>
          </tr>
        </thead>
        <tbody>
          ${topSellersRows}
        </tbody>
      </table>
    </div>
  ` : '';

  // Expense Breakdown rows
  const expenseRows = report.expenseBreakdown.map((eb) => `
    <tr>
      <td class="item-name" style="color:#1f2937">${escapeHtml(eb.label)}</td>
      <td style="text-align:right; width:100px; color:#dc2626; font-weight:600">${formatCurrency(eb.total)}</td>
      <td style="width:160px; padding-left:16px">
        <div style="display:flex; align-items:center; gap:8px">
          <div style="flex:1; height:6px; background:#e5e7eb; border-radius:3px; overflow:hidden">
            <div style="width:${eb.percentage}%; height:100%; background:#dc2626; border-radius:3px"></div>
          </div>
          <span style="font-size:11px; color:#6b7280; width:32px; text-align:right">${eb.percentage}%</span>
        </div>
      </td>
    </tr>
  `).join('');

  const expenseSection = report.expenseBreakdown.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <span class="section-icon">📊</span>
        <h2 class="section-title">Expense Breakdown</h2>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Category</th>
            <th style="width:100px; text-align:right">Amount</th>
            <th style="width:160px">Share</th>
          </tr>
        </thead>
        <tbody>
          ${expenseRows}
        </tbody>
      </table>
    </div>
  ` : '';

  // Inventory Snapshot rows
  const inventoryRows = inventory.slice(0, 20).map((item) => {
    const estValue = item.price != null ? item.quantity * item.price : null;
    return `
      <tr>
        <td class="item-name" style="color:#1f2937">${escapeHtml(item.item_name)}</td>
        <td style="text-align:center; width:80px; color:#374151">${item.quantity}</td>
        <td style="text-align:center; width:70px; color:#374151; font-size:12px">${escapeHtml(item.unit)}</td>
        <td style="text-align:right; width:90px; color:#374151">${item.price != null ? formatCurrency(item.price) : '—'}</td>
        <td style="text-align:right; width:100px; color:#2D5A3D; font-weight:600">${estValue != null ? formatCurrency(estValue) : '—'}</td>
      </tr>
    `;
  }).join('');

  const inventorySection = inventory.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <span class="section-icon">📦</span>
        <h2 class="section-title">Inventory Snapshot</h2>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Item</th>
            <th style="width:80px; text-align:center">Qty</th>
            <th style="width:70px; text-align:center">Unit</th>
            <th style="width:90px; text-align:right">Price</th>
            <th style="width:100px; text-align:right">Est. Value</th>
          </tr>
        </thead>
        <tbody>
          ${inventoryRows}
        </tbody>
      </table>
    </div>
  ` : '';

  // Recent Transactions rows
  const transactionRows = report.recentActivity.slice(0, 15).map((a) => {
    const isExpense = a.type === 'expense';
    const amountStr = a.amount != null
      ? `<span style="color:${isExpense ? '#dc2626' : '#2D5A3D'}; font-weight:600">${isExpense ? '-' : '+'}${formatCurrency(a.amount)}</span>`
      : '—';
    const typeBadge = isExpense
      ? `<span class="badge badge-expense">Expense</span>`
      : `<span class="badge badge-sale">Sale</span>`;
    return `
      <tr>
        <td style="width:80px; font-size:11px; color:#6b7280">${formatRelativeDate(a.timestamp)}</td>
        <td style="width:80px">${typeBadge}</td>
        <td class="item-name" style="color:#1f2937">${escapeHtml(a.label)}</td>
        <td style="text-align:right; width:100px">${amountStr}</td>
      </tr>
    `;
  }).join('');

  const transactionsSection = report.recentActivity.length > 0 ? `
    <div class="section">
      <div class="section-header">
        <span class="section-icon">📝</span>
        <h2 class="section-title">Recent Transactions</h2>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width:80px">When</th>
            <th style="width:80px">Type</th>
            <th>Description</th>
            <th style="width:100px; text-align:right">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${transactionRows}
        </tbody>
      </table>
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(report.farmstandName)} — Business Report</title>
  <style>
    /* ── Reset: every element gets an explicit color so expo-print WebView
       never falls back to white-on-white text ── */
    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html {
      background: #ffffff;
      color: #1f2937;
    }

    body {
      font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
      background: #ffffff;
      color: #1f2937;
      font-size: 14px;
      line-height: 1.5;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      max-width: 680px;
      margin: 0 auto;
      background: #ffffff;
      min-height: 100vh;
    }

    /* ── Header (green bg, white text — must be explicit) ── */
    .report-header {
      background: #2D5A3D;
      padding: 40px 40px 36px;
    }

    .brand-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 24px;
    }

    .brand-leaf {
      width: 32px;
      height: 32px;
      background: rgba(255,255,255,0.15);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      color: #ffffff;
    }

    .brand-name {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #ffffff;
    }

    .report-title {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #a7c4b0;
      margin-bottom: 6px;
    }

    .farmstand-name {
      font-size: 28px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: -0.5px;
      line-height: 1.2;
      margin-bottom: 8px;
    }

    .report-meta {
      font-size: 13px;
      color: #c4dbc9;
    }

    /* ── Summary Cards (white bg, explicit dark text) ── */
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      border-bottom: 1px solid #e5e7eb;
      background: #ffffff;
    }

    .summary-card {
      padding: 24px 28px;
      border-right: 1px solid #e5e7eb;
      border-bottom: 1px solid #e5e7eb;
      background: #ffffff;
    }

    .summary-card:nth-child(2n) { border-right: none; }
    .summary-card:nth-child(3),
    .summary-card:nth-child(4) { border-bottom: none; }

    .summary-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #6b7280;
      margin-bottom: 6px;
    }

    .summary-value {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
      line-height: 1;
      color: #1f2937;
    }

    .summary-sub {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 4px;
    }

    /* ── Sections ── */
    .section {
      padding: 28px 40px;
      border-bottom: 1px solid #e5e7eb;
      background: #ffffff;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }

    .section-icon {
      font-size: 16px;
      color: #374151;
    }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #374151;
    }

    /* ── Tables ── */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      background: #ffffff;
    }

    .data-table thead tr {
      border-bottom: 2px solid #e5e7eb;
      background: #ffffff;
    }

    .data-table th {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #6b7280;
      padding: 0 0 10px;
      text-align: left;
      background: #ffffff;
    }

    .data-table tbody tr {
      border-bottom: 1px solid #f3f4f6;
      background: #ffffff;
    }

    .data-table tbody tr:last-child {
      border-bottom: none;
    }

    .data-table td {
      padding: 10px 0;
      color: #1f2937;
      vertical-align: middle;
      background: #ffffff;
    }

    .rank {
      width: 40px;
      color: #6b7280;
      font-weight: 600;
      font-size: 13px;
    }

    .item-name {
      font-weight: 500;
      color: #1f2937;
    }

    .qty {
      text-align: center;
      width: 80px;
      color: #374151;
    }

    .amount {
      text-align: right;
      width: 100px;
      font-weight: 700;
      color: #2D5A3D;
    }

    /* ── Badges ── */
    .badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 10px;
    }

    .badge-sale {
      background: #dcfce7;
      color: #166534;
    }

    .badge-expense {
      background: #fee2e2;
      color: #991b1b;
    }

    /* ── Footer ── */
    .report-footer {
      padding: 24px 40px;
      text-align: center;
      background: #f9fafb;
      border-top: 1px solid #e5e7eb;
    }

    .footer-brand {
      font-size: 12px;
      font-weight: 700;
      color: #2D5A3D;
      margin-bottom: 4px;
    }

    .footer-meta {
      font-size: 11px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="page">

    <!-- Header -->
    <div class="report-header">
      <div class="report-title">Business Report</div>
      <div class="farmstand-name">${escapeHtml(report.farmstandName)}</div>
      <div class="report-meta">${escapeHtml(dateLabel)} &nbsp;·&nbsp; Generated ${generatedDate} at ${generatedTime}</div>
    </div>

    <!-- Summary Grid -->
    <div class="summary-grid">
      <div class="summary-card">
        <div class="summary-label">Revenue</div>
        <div class="summary-value" style="color:#2D5A3D">${formatCurrency(report.summary.revenue)}</div>
        <div class="summary-sub">Total sales income</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Expenses</div>
        <div class="summary-value" style="color:#dc2626">${formatCurrency(report.summary.expenses)}</div>
        <div class="summary-sub">Total operating costs</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Net Profit</div>
        <div class="summary-value" style="color:${netProfitColor}">${formatCurrency(report.summary.netProfit)}</div>
        <div class="summary-sub">Revenue minus expenses</div>
      </div>
      <div class="summary-card">
        <div class="summary-label">Inventory Value</div>
        <div class="summary-value" style="color:#d97706">${formatCurrency(report.summary.inventoryValue)}</div>
        <div class="summary-sub">Estimated stock value</div>
      </div>
    </div>

    ${topSellersSection}
    ${expenseSection}
    ${inventorySection}
    ${transactionsSection}

    <!-- Footer -->
    <div class="report-footer">
      <div class="footer-meta">contact@farmstand.online &nbsp;·&nbsp; Generated ${generatedDate}</div>
    </div>

  </div>
</body>
</html>
  `.trim();
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function exportToPdf(
  report: FarmstandReportData,
  inventory: InventoryItem[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const html = buildPdfHtml(report, inventory);
    const { uri } = await Print.printToFileAsync({ html, base64: false });

    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      return { success: false, error: 'Sharing is not available on this device.' };
    }

    const fileName = `${report.farmstandName.replace(/[^a-z0-9]/gi, '_')}_Report_${new Date().toISOString().slice(0, 10)}.pdf`;
    const destUri = `${FileSystem.cacheDirectory}${fileName}`;
    await FileSystem.copyAsync({ from: uri, to: destUri });

    await Sharing.shareAsync(destUri, {
      mimeType: 'application/pdf',
      dialogTitle: `${report.farmstandName} — Business Report`,
      UTI: 'com.adobe.pdf',
    });

    return { success: true };
  } catch (err) {
    console.error('[Manager] exportToPdf error:', err);
    return { success: false, error: 'Failed to generate PDF.' };
  }
}

// ============================================================
// CSV EXPORT
// ============================================================

function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map((c) => {
    const s = c == null ? '' : String(c);
    // Wrap in quotes if contains comma, newline, or quote
    if (s.includes(',') || s.includes('\n') || s.includes('"')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }).join(',');
}

function buildCsvContent(
  report: FarmstandReportData,
  inventory: InventoryItem[]
): string {
  const dateLabel = DATE_RANGE_LABELS[report.dateRange.preset];
  const generatedAt = new Date(report.generatedAt).toISOString().slice(0, 10);
  const sections: string[] = [];

  // ── Sheet 1: Summary (one header row + one data row) ──────────────────────
  sections.push(csvRow(['Farmstand', 'Period', 'Generated', 'Revenue', 'Expenses', 'Net Profit', 'Inventory Value']));
  sections.push(csvRow([
    report.farmstandName,
    dateLabel,
    generatedAt,
    report.summary.revenue.toFixed(2),
    report.summary.expenses.toFixed(2),
    report.summary.netProfit.toFixed(2),
    report.summary.inventoryValue.toFixed(2),
  ]));

  // ── Sheet 2: Transactions (sales + expenses flat list) ─────────────────────
  if (report.recentActivity.length > 0) {
    sections.push('');
    sections.push(csvRow(['Type', 'Item', 'Amount', 'Date']));
    report.recentActivity.forEach((a) => {
      const dateStr = new Date(a.timestamp).toISOString().slice(0, 10);
      sections.push(csvRow([
        a.type === 'sale' ? 'Sale' : 'Expense',
        a.label,
        a.amount != null ? a.amount.toFixed(2) : '0.00',
        dateStr,
      ]));
    });
  }

  // ── Sheet 3: Top sellers ───────────────────────────────────────────────────
  if (report.topSellingItems.length > 0) {
    sections.push('');
    sections.push(csvRow(['Item', 'Quantity Sold', 'Revenue']));
    report.topSellingItems.slice(0, 10).forEach((item) => {
      sections.push(csvRow([item.item_name, item.totalQuantity, item.totalRevenue.toFixed(2)]));
    });
  }

  // ── Sheet 4: Expenses by category ─────────────────────────────────────────
  if (report.expenseBreakdown.length > 0) {
    sections.push('');
    sections.push(csvRow(['Category', 'Amount', 'Percentage']));
    report.expenseBreakdown.forEach((eb) => {
      sections.push(csvRow([eb.label, eb.total.toFixed(2), `${eb.percentage}%`]));
    });
  }

  // ── Sheet 5: Inventory ─────────────────────────────────────────────────────
  if (inventory.length > 0) {
    sections.push('');
    sections.push(csvRow(['Item', 'Category', 'Quantity', 'Unit', 'Price', 'Est. Value']));
    inventory.forEach((item) => {
      const estValue = item.price != null ? (item.quantity * item.price).toFixed(2) : '';
      sections.push(csvRow([
        item.item_name,
        item.category ?? '',
        item.quantity,
        item.unit,
        item.price != null ? item.price.toFixed(2) : '',
        estValue,
      ]));
    });
  }

  return sections.join('\n');
}

export async function exportToCsv(
  report: FarmstandReportData,
  inventory: InventoryItem[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      return { success: false, error: 'Sharing is not available on this device.' };
    }

    const csvContent = buildCsvContent(report, inventory);
    const fileName = `${report.farmstandName.replace(/[^a-z0-9]/gi, '_')}_Report_${new Date().toISOString().slice(0, 10)}.csv`;
    const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

    await FileSystem.writeAsStringAsync(fileUri, csvContent, {
      encoding: FileSystem.EncodingType.UTF8,
    });

    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/csv',
      dialogTitle: `${report.farmstandName} — Business Report`,
      UTI: 'public.comma-separated-values-text',
    });

    return { success: true };
  } catch (err) {
    console.error('[Manager] exportToCsv error:', err);
    return { success: false, error: 'Failed to export CSV.' };
  }
}

// ============================================================
// PLAIN TEXT SHARE (fallback)
// ============================================================

import { Share } from 'react-native';

export async function shareReportText(report: FarmstandReportData): Promise<void> {
  const dateLabel = DATE_RANGE_LABELS[report.dateRange.preset];
  const lines: string[] = [
    `🌿 ${report.farmstandName} — Business Report`,
    `Period: ${dateLabel}`,
    '',
    '—— SUMMARY ——',
    `Revenue:         ${formatCurrency(report.summary.revenue)}`,
    `Expenses:        ${formatCurrency(report.summary.expenses)}`,
    `Net Profit:      ${formatCurrency(report.summary.netProfit)}`,
    `Inventory Value: ${formatCurrency(report.summary.inventoryValue)}`,
    '',
  ];

  if (report.topSellingItems.length > 0) {
    lines.push('—— TOP SELLERS ——');
    report.topSellingItems.slice(0, 5).forEach((item, i) => {
      lines.push(`${i + 1}. ${item.item_name}: ${formatCurrency(item.totalRevenue)}`);
    });
    lines.push('');
  }

  if (report.expenseBreakdown.length > 0) {
    lines.push('—— EXPENSES ——');
    report.expenseBreakdown.forEach((eb) => {
      lines.push(`${eb.label}: ${formatCurrency(eb.total)} (${eb.percentage}%)`);
    });
    lines.push('');
  }

  lines.push(`Generated: ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push('🌿 Farmstand · Fresh & Local · contact@farmstand.online');

  await Share.share({
    message: lines.join('\n'),
    title: `${report.farmstandName} — Business Report`,
  });
}
