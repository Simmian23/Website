import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.UPKEPT_DATA_PATH = ':memory:';

import { startServer } from '../src/web-app.js';

const baseUrl = (port, path) => `http://127.0.0.1:${port}${path}`;

async function fetchWithCookies(url, options = {}, jar = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Connection', 'close');
  if (jar.cookie) {
    headers.set('Cookie', jar.cookie);
  }
  const response = await fetch(url, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual'
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
    jar.cookie = setCookie.split(',')[0].split(';')[0];
  }
  return response;
}

test('end-to-end marketplace flow', async () => {
  const { server, port } = await startServer(0);
  try {
    const clientJar = {};
    const registerClient = await fetchWithCookies(baseUrl(port, '/api/auth/register'), {
      method: 'POST',
      body: {
        name: 'Harper Client',
        email: 'harper@example.com',
        password: 'StrongPass!23',
        role: 'homeowner'
      }
    }, clientJar);
    assert.equal(registerClient.status, 201);

    const projectResponse = await fetchWithCookies(baseUrl(port, '/api/projects'), {
      method: 'POST',
      body: {
        title: 'Deck rebuild',
        scope: 'Remove rotten boards and install composite decking',
        budget: '$18,000',
        timeline: '2025-Q1',
        city: 'Kelowna',
        province: 'BC',
        tradeType: 'Carpentry',
        milestones: [{ title: 'Deposit', amount: 9500 }]
      }
    }, clientJar);
    assert.equal(projectResponse.status, 201);
    const { project } = await projectResponse.json();
    assert.equal(project.title, 'Deck rebuild');
    assert.equal(project.milestones.length, 1);

    const projectsList = await fetchWithCookies(baseUrl(port, '/api/projects/mine'), { method: 'GET' }, clientJar);
    const listPayload = await projectsList.json();
    assert.equal(listPayload.projects.length, 1);

    const contractorJar = {};
    const registerContractor = await fetchWithCookies(baseUrl(port, '/api/auth/register'), {
      method: 'POST',
      body: {
        name: 'River Contractor',
        email: 'river@example.com',
        password: 'StrongPass!23',
        role: 'contractor'
      }
    }, contractorJar);
    assert.equal(registerContractor.status, 201);

    const profileResponse = await fetchWithCookies(baseUrl(port, '/api/contractors/apply'), {
      method: 'POST',
      body: {
        companyName: 'River Builds',
        trades: ['Decking', 'Carpentry'],
        province: 'BC',
        city: 'Kelowna',
        summary: 'Certified contractor focused on exterior projects',
        yearsInBusiness: 7,
        isPremium: true
      }
    }, contractorJar);
    assert.equal(profileResponse.status, 201);
    const { contractor } = await profileResponse.json();
    const contractorId = contractor.id;

    const adminJar = {};
    const adminRegister = await fetchWithCookies(baseUrl(port, '/api/auth/register'), {
      method: 'POST',
      body: {
        name: 'Avery Admin',
        email: 'admin@upkept.ca',
        password: 'StrongPass!23',
        role: 'admin'
      }
    }, adminJar);
    assert.equal(adminRegister.status, 201);

    const pendingVerifications = await fetchWithCookies(
      baseUrl(port, '/api/verifications'),
      { method: 'GET' },
      adminJar
    );
    assert.equal(pendingVerifications.status, 200);
    const verificationPayload = await pendingVerifications.json();
    assert.equal(verificationPayload.verifications.length, 1);

    const approveVerification = await fetchWithCookies(
      baseUrl(port, `/api/verifications/${contractorId}/status`),
      {
        method: 'POST',
        body: {
          status: 'approved',
          notes: 'Verified licenses on file'
        }
      },
      adminJar
    );
    assert.equal(approveVerification.status, 200);

    const quoteResponse = await fetchWithCookies(baseUrl(port, '/api/quotes'), {
      method: 'POST',
      body: {
        projectId: project.id,
        amount: '$17,500',
        message: 'Includes permits and inspections',
        timeline: '6 weeks'
      }
    }, contractorJar);
    assert.equal(quoteResponse.status, 201);
    const { quote } = await quoteResponse.json();

    const approveQuote = await fetchWithCookies(baseUrl(port, `/api/quotes/${quote.id}/status`), {
      method: 'POST',
      body: { status: 'approved' }
    }, clientJar);
    assert.equal(approveQuote.status, 200);

    const milestoneId = project.milestones[0].id;
    const fundEscrow = await fetchWithCookies(baseUrl(port, '/api/payments/fund'), {
      method: 'POST',
      body: {
        projectId: project.id,
        milestoneId,
        amount: 9500
      }
    }, clientJar);
    assert.equal(fundEscrow.status, 201);
    const { payment } = await fundEscrow.json();
    assert.equal(payment.status, 'funded');

    const paymentsForAdmin = await fetchWithCookies(baseUrl(port, '/api/payments?status=funded'), { method: 'GET' }, adminJar);
    assert.equal(paymentsForAdmin.status, 200);
    const fundedPayload = await paymentsForAdmin.json();
    assert.equal(fundedPayload.payments.length, 1);

    const releasePayment = await fetchWithCookies(baseUrl(port, '/api/payments/release'), {
      method: 'POST',
      body: {
        paymentId: payment.id
      }
    }, adminJar);
    assert.equal(releasePayment.status, 200);
    const { payment: releasedPayment } = await releasePayment.json();
    assert.equal(releasedPayment.status, 'released');

    const quotesForClient = await fetchWithCookies(baseUrl(port, '/api/quotes/for-projects'), { method: 'GET' }, clientJar);
    const quotesPayload = await quotesForClient.json();
    assert.equal(quotesPayload.quotes.length, 1);
    assert.equal(quotesPayload.quotes[0].amount, '$17,500');

    const reviewResponse = await fetchWithCookies(baseUrl(port, '/api/reviews'), {
      method: 'POST',
      body: {
        projectId: project.id,
        contractorId,
        rating: 5,
        comment: 'Outstanding craftsmanship and communication.'
      }
    }, clientJar);
    assert.equal(reviewResponse.status, 201);

    const directoryResponse = await fetchWithCookies(
      baseUrl(port, '/api/directory/contractors?verified=true&premium=true'),
      { method: 'GET' }
    );
    assert.equal(directoryResponse.status, 200);
    const directoryPayload = await directoryResponse.json();
    assert.ok(directoryPayload.contractors.some((entry) => entry.averageRating === 5));

    const chatbotResponse = await fetchWithCookies(baseUrl(port, '/api/chatbot/kee'), {
      method: 'POST',
      body: { intent: 'escrow' }
    });
    assert.equal(chatbotResponse.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
