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
        tradeType: 'Carpentry'
      }
    }, clientJar);
    assert.equal(projectResponse.status, 201);
    const { project } = await projectResponse.json();
    assert.equal(project.title, 'Deck rebuild');

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
        yearsInBusiness: 7
      }
    }, contractorJar);
    assert.equal(profileResponse.status, 201);

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

    const quotesForClient = await fetchWithCookies(baseUrl(port, '/api/quotes/for-projects'), { method: 'GET' }, clientJar);
    const quotesPayload = await quotesForClient.json();
    assert.equal(quotesPayload.quotes.length, 1);
    assert.equal(quotesPayload.quotes[0].amount, '$17,500');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
