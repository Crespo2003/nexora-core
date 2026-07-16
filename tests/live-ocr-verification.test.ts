import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { extractTenancyDetails } from '../lib/ai/tenancyExtractor';
import { extractUtilityBill } from '../lib/collections/core';
import { OpenAiOcrProvider } from '../lib/ocr/openAiOcr';

const liveOcrEnabled = process.env.LIVE_OCR === '1' && Boolean(process.env.OPENAI_API_KEY);

test('live OCR verifies synthetic scanned tenancy and utility fixtures', { skip: !liveOcrEnabled }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const agreementImage = await syntheticScan(browser, `
      TENANCY AGREEMENT
      Landlord: Lim Wei Jian | Phone: 012-111 2233
      Tenant: Aisha Rahman | Passport: A12345678 | Phone: 012-987 6543
      Property: Unit A-12-3, Nexora Residence, Kuala Lumpur
      Monthly Rental: RM 2,500.00
      Security Deposit: RM 5,000.00 | Utility Deposit: RM 1,000.00
      Access Card Deposit: RM 200.00 | Car Park Remote Deposit: RM 150.00
      Commencement Date: 01/08/2026 | Expiry Date: 31/07/2027
      Rental Due Day: 1 | Renewal Option: One year
      Notice Period: Two months | Special Clause: No subletting
    `);
    const utilityImage = await syntheticScan(browser, `
      TNB ELECTRICITY BILL
      Account Number: 2200 7788 9911 | Meter Number: MTR-884422
      Registered Name: Aisha Rahman
      Service Address: Unit A-12-3, Nexora Residence, Kuala Lumpur
      Bill Number: TNB-2026-08-001 | Bill Date: 05/08/2026
      Billing Period: 01/07/2026 - 31/07/2026
      Due Date: 20/08/2026 | Amount Due: RM 186.40
    `);

    const provider = new OpenAiOcrProvider(process.env.OPENAI_API_KEY!);
    const agreementOcr = await provider.extractText({ buffer: agreementImage, mimeType: 'image/png', filename: 'synthetic-tenancy.png' });
    const utilityOcr = await provider.extractText({ buffer: utilityImage, mimeType: 'image/png', filename: 'synthetic-utility.png' });
    assert.equal(agreementOcr.status, 'completed');
    assert.equal(utilityOcr.status, 'completed');

    const tenancy = await extractTenancyDetails(agreementOcr.text, 'synthetic-tenancy.png', 'image/png');
    const bill = extractUtilityBill(utilityOcr.text, 'synthetic-utility.png');
    assert.match(tenancy.tenant.name.value, /Aisha Rahman/i);
    assert.equal(tenancy.financial.monthlyRental.value, '2500');
    assert.equal(tenancy.tenant.email.value, '');
    assert.equal(tenancy.tenant.email.confidence, 'low');
    assert.ok(['high', 'medium', 'low'].includes(tenancy.tenant.name.confidence));
    assert.equal(bill.provider, 'tnb');
    assert.match(bill.accountNumber, /2200/);
    assert.equal(Number(bill.totalAmountDue), 186.4);
  } finally {
    await browser.close();
  }
});

async function syntheticScan(browser: Awaited<ReturnType<typeof chromium.launch>>, content: string) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  await page.setContent(`<main style="white-space:pre-line;font:28px/1.7 Arial;padding:70px;color:#111;background:#fff">${escapeHtml(content)}</main>`);
  const image = await page.screenshot({ type: 'png', fullPage: true });
  await page.close();
  return image;
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
