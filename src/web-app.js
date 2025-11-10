import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DataStore, hashPassword, verifyPassword } from './data-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.join(__dirname, '..', 'upkept');

const allowedRoles = new Set(['homeowner', 'property_manager', 'contractor', 'admin']);

function parseCookies(cookieHeader) {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, part) => {
    const [key, value] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(value || '');
    return acc;
  }, {});
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
  return true;
}

async function readRequestBody(req) {
  return await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function serializeCookie(name, value, options = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}`;
  if (options.maxAge) cookie += `; Max-Age=${options.maxAge}`;
  if (options.httpOnly !== false) cookie += '; HttpOnly';
  if (options.path) cookie += `; Path=${options.path}`;
  if (options.sameSite) cookie += `; SameSite=${options.sameSite}`;
  if (options.secure) cookie += '; Secure';
  return cookie;
}

function publicContractor(contractor, store) {
  const base = { ...contractor };
  delete base.userId;
  const user = store.findUserById(contractor.userId);
  const reviews = store.listReviews({ contractorId: contractor.id, status: 'published' });
  const averageRating = reviews.length
    ? Number((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length).toFixed(2))
    : null;
  return {
    ...base,
    contactName: user?.name || null,
    contactEmail: user?.email || null,
    reviewCount: reviews.length,
    averageRating
  };
}

function publicProject(project, store) {
  const client = store.findUserById(project.clientId);
  return {
    ...project,
    clientName: client?.name || null
  };
}

function publicQuote(quote, store) {
  const contractor = store.data.contractors.find((entry) => entry.id === quote.contractorId);
  const contractorUser = contractor ? store.findUserById(contractor.userId) : null;
  return {
    ...quote,
    contractor: contractor
      ? {
          id: contractor.id,
          companyName: contractor.companyName,
          trades: contractor.trades,
          contactName: contractorUser?.name || null
        }
      : null
  };
}

function publicReview(review, store) {
  const contractor = store.data.contractors.find((entry) => entry.id === review.contractorId);
  const client = store.findUserById(review.clientId);
  return {
    ...review,
    contractor: contractor ? publicContractor(contractor, store) : null,
    client: client ? { id: client.id, name: client.name } : null
  };
}

function publicPayment(payment, store) {
  const project = store.findProjectById(payment.projectId);
  const contractor = project ? store.data.contractors.find((entry) => entry.id === project.awardedContractorId) : null;
  return {
    ...payment,
    project: project ? { id: project.id, title: project.title } : null,
    contractor: contractor ? publicContractor(contractor, store) : null
  };
}

function publicVerification(record, store) {
  const contractor = store.data.contractors.find((entry) => entry.id === record.contractorId);
  return {
    ...record,
    contractor: contractor ? publicContractor(contractor, store) : null
  };
}

async function serveStatic(req, res, pathname) {
  let filePath = path.join(staticDir, pathname);
  try {
    const stats = await fs.stat(filePath).catch(() => null);
    if (stats && stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const contentType =
      ext === '.html'
        ? 'text/html; charset=utf-8'
        : ext === '.css'
        ? 'text/css; charset=utf-8'
        : ext === '.js'
        ? 'application/javascript; charset=utf-8'
        : ext === '.json'
        ? 'application/json; charset=utf-8'
        : ext === '.svg'
        ? 'image/svg+xml'
        : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

async function handleAuthRoutes(req, res, pathname, method, store, sessionContext) {
  if (pathname === '/api/auth/register' && method === 'POST') {
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const { name, email, password, role } = body;
    if (!name || !email || !password || !role || !allowedRoles.has(role)) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    try {
      const user = await store.createUser({
        name: name.trim(),
        email: email.trim(),
        passwordHash: hashPassword(password),
        role
      });
      const session = await store.createSession(user.id);
      const cookie = serializeCookie('upkept_session', session.token, {
        httpOnly: true,
        path: '/',
        sameSite: 'Lax'
      });
      return sendJson(
        res,
        201,
        { user },
        {
          'Set-Cookie': cookie
        }
      );
    } catch (error) {
      if (error.message === 'EMAIL_IN_USE') {
        return sendJson(res, 409, { error: 'EMAIL_IN_USE' });
      }
      return sendJson(res, 500, { error: 'SERVER_ERROR' });
    }
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const { email, password } = body;
    if (!email || !password) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    const user = store.findUserByEmail(email.trim());
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return sendJson(res, 401, { error: 'INVALID_CREDENTIALS' });
    }
    const session = await store.createSession(user.id);
    const cookie = serializeCookie('upkept_session', session.token, {
      httpOnly: true,
      path: '/',
      sameSite: 'Lax'
    });
    return sendJson(
      res,
      200,
      { user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt } },
      {
        'Set-Cookie': cookie
      }
    );
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const cookieHeader = req.headers.cookie || '';
    const cookies = parseCookies(cookieHeader);
    if (cookies.upkept_session) {
      store.destroySession(cookies.upkept_session);
    }
    return sendJson(
      res,
      200,
      { success: true },
      {
        'Set-Cookie': serializeCookie('upkept_session', '', {
          httpOnly: true,
          path: '/',
          sameSite: 'Lax',
          maxAge: 0
        })
      }
    );
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    if (!sessionContext.user) {
      return sendJson(res, 200, { user: null });
    }
    const { id, name, email, role, createdAt } = sessionContext.user;
    return sendJson(res, 200, { user: { id, name, email, role, createdAt } });
  }

  return false;
}

function ensureAuthenticated(res, sessionContext, roles = []) {
  if (!sessionContext.user) {
    sendJson(res, 401, { error: 'UNAUTHENTICATED' });
    return false;
  }
  if (roles.length && !roles.includes(sessionContext.user.role)) {
    sendJson(res, 403, { error: 'FORBIDDEN' });
    return false;
  }
  return true;
}

async function handleProjectsRoutes(req, res, pathname, method, store, sessionContext) {
  if (pathname === '/api/projects' && method === 'POST') {
    if (!ensureAuthenticated(res, sessionContext, ['homeowner', 'property_manager'])) return true;
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const { title, scope, budget, timeline, city, province, tradeType, milestones = [] } = body;
    if (!title || !scope) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    const normalizedMilestones = Array.isArray(milestones)
      ? milestones
          .map((milestone) => ({
            title: milestone?.title || 'Milestone',
            description: milestone?.description || '',
            amount: milestone?.amount,
            dueDate: milestone?.dueDate || null
          }))
          .slice(0, 10)
      : [];
    const project = await store.createProject({
      clientId: sessionContext.user.id,
      title: title.trim(),
      scope: scope.trim(),
      budget: budget?.trim() || '',
      timeline: timeline?.trim() || '',
      city: city?.trim() || '',
      province: province?.trim() || '',
      tradeType: tradeType?.trim() || '',
      milestones: normalizedMilestones
    });
    return sendJson(res, 201, { project: publicProject(project, store) });
  }

  if (pathname === '/api/projects/mine' && method === 'GET') {
    if (!ensureAuthenticated(res, sessionContext, ['homeowner', 'property_manager'])) return true;
    const projects = store.listProjects({ clientId: sessionContext.user.id }).map((project) => publicProject(project, store));
    return sendJson(res, 200, { projects });
  }

  if (pathname === '/api/projects/open' && method === 'GET') {
    if (!ensureAuthenticated(res, sessionContext, ['contractor', 'admin'])) return true;
    const filters = {};
    const search = new URL(req.url, `http://${req.headers.host}`).searchParams;
    if (search.get('tradeType')) filters.tradeType = search.get('tradeType');
    if (search.get('province')) filters.province = search.get('province');
    if (search.get('city')) filters.city = search.get('city');
    const projects = store
      .listProjects({ status: 'posted', ...filters })
      .map((project) => publicProject(project, store));
    return sendJson(res, 200, { projects });
  }

  if (pathname === '/api/projects/assigned' && method === 'GET') {
    if (!ensureAuthenticated(res, sessionContext, ['contractor'])) return true;
    const contractorProfile = store.listContractors().find((entry) => entry.userId === sessionContext.user.id);
    if (!contractorProfile) {
      return sendJson(res, 200, { projects: [] });
    }
    const projects = store
      .listProjects({ contractorId: contractorProfile.id })
      .map((project) => publicProject(project, store));
    return sendJson(res, 200, { projects });
  }

  if (pathname.startsWith('/api/projects/') && method === 'GET') {
    const parts = pathname.split('/');
    if (parts.length === 4 && parts[3]) {
      if (!ensureAuthenticated(res, sessionContext, ['homeowner', 'property_manager', 'contractor', 'admin'])) return true;
      const projectId = Number.parseInt(parts[3], 10);
      const project = store.findProjectById(projectId);
      if (!project) {
        return sendJson(res, 404, { error: 'NOT_FOUND' });
      }
      return sendJson(res, 200, { project: publicProject(project, store) });
    }
  }

  if (pathname.startsWith('/api/projects/') && pathname.endsWith('/status') && method === 'POST') {
    const parts = pathname.split('/');
    const projectId = Number.parseInt(parts[3], 10);
    if (!ensureAuthenticated(res, sessionContext, ['homeowner', 'property_manager', 'admin'])) return true;
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const { status } = body;
    if (!['posted', 'in_escrow', 'completed', 'cancelled'].includes(status)) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    try {
      const project = await store.updateProjectStatus(projectId, status);
      return sendJson(res, 200, { project: publicProject(project, store) });
    } catch (error) {
      if (error.message === 'NOT_FOUND') {
        return sendJson(res, 404, { error: 'NOT_FOUND' });
      }
      return sendJson(res, 500, { error: 'SERVER_ERROR' });
    }
  }

  if (
    pathname.startsWith('/api/projects/') &&
    pathname.includes('/milestones/') &&
    pathname.endsWith('/status') &&
    method === 'POST'
  ) {
    if (!ensureAuthenticated(res, sessionContext, ['homeowner', 'property_manager', 'admin'])) return true;
    const parts = pathname.split('/');
    const projectId = Number.parseInt(parts[3], 10);
    const milestoneId = Number.parseInt(parts[5], 10);
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const { status } = body;
    if (!['pending', 'funded', 'submitted', 'released', 'disputed'].includes(status)) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    try {
      const { project } = await store.setMilestoneStatus(projectId, milestoneId, status);
      return sendJson(res, 200, { project: publicProject(project, store) });
    } catch (error) {
      if (error.message === 'NOT_FOUND') {
        return sendJson(res, 404, { error: 'NOT_FOUND' });
      }
      return sendJson(res, 500, { error: 'SERVER_ERROR' });
    }
  }

  return false;
}

async function handleContractorRoutes(req, res, pathname, method, store, sessionContext) {
  if (pathname === '/api/contractors' && method === 'GET') {
    const search = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const contractors = store
      .listContractors({
        status: search.get('status') || undefined,
        trade: search.get('trade') || undefined,
        province: search.get('province') || undefined,
        city: search.get('city') || undefined,
        premium: search.get('premium') === 'true'
      })
      .map((contractor) => publicContractor(contractor, store));
    return sendJson(res, 200, { contractors });
  }

  if (pathname === '/api/contractors/apply' && method === 'POST') {
    if (!ensureAuthenticated(res, sessionContext, ['contractor'])) return true;
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const { companyName, trades, province, city, summary, yearsInBusiness, isPremium } = body;
    if (!companyName || !trades) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    const contractor = await store.createContractorProfile({
      userId: sessionContext.user.id,
      companyName: companyName.trim(),
      trades: Array.isArray(trades) ? trades.join(', ') : String(trades || '').trim(),
      province: province?.trim() || '',
      city: city?.trim() || '',
      summary: summary?.trim() || '',
      yearsInBusiness: Number.parseInt(yearsInBusiness, 10) || 0,
      isPremium: Boolean(isPremium)
    });
    return sendJson(res, 201, { contractor: publicContractor(contractor, store) });
  }

  if (pathname === '/api/contractors/applications' && method === 'GET') {
    if (!ensureAuthenticated(res, sessionContext, ['admin'])) return true;
    const contractors = store
      .listContractors()
      .filter((contractor) => contractor.status !== 'approved')
      .map((contractor) => publicContractor(contractor, store));
    return sendJson(res, 200, { contractors });
  }

  if (pathname.startsWith('/api/contractors/') && pathname.endsWith('/status') && method === 'POST') {
    if (!ensureAuthenticated(res, sessionContext, ['admin'])) return true;
    const contractorId = Number.parseInt(pathname.split('/')[3], 10);
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const { status } = body;
    if (!['pending', 'approved', 'needs_revision'].includes(status)) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    try {
      const contractor = await store.setContractorStatus(contractorId, status);
      return sendJson(res, 200, { contractor: publicContractor(contractor, store) });
    } catch (error) {
      if (error.message === 'NOT_FOUND') {
        return sendJson(res, 404, { error: 'NOT_FOUND' });
      }
      return sendJson(res, 500, { error: 'SERVER_ERROR' });
    }
  }

  return false;
}

async function handleQuoteRoutes(req, res, pathname, method, store, sessionContext) {
  if (pathname === '/api/quotes' && method === 'POST') {
    if (!ensureAuthenticated(res, sessionContext, ['contractor'])) return true;
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const { projectId, amount, message, timeline } = body;
    if (!projectId || !amount) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    const contractorProfile = store.listContractors().find((entry) => entry.userId === sessionContext.user.id);
    if (!contractorProfile) {
      return sendJson(res, 400, { error: 'CONTRACTOR_PROFILE_REQUIRED' });
    }
    try {
      const quote = await store.createQuote({
        projectId: Number.parseInt(projectId, 10),
        contractorId: contractorProfile.id,
        amount: String(amount).trim(),
        message: message?.trim() || '',
        timeline: timeline?.trim() || ''
      });
      return sendJson(res, 201, { quote: publicQuote(quote, store) });
    } catch (error) {
      if (error.message === 'PROJECT_NOT_FOUND') {
        return sendJson(res, 404, { error: 'PROJECT_NOT_FOUND' });
      }
      if (error.message === 'CONTRACTOR_REQUIRED') {
        return sendJson(res, 400, { error: 'CONTRACTOR_PROFILE_REQUIRED' });
      }
      return sendJson(res, 500, { error: 'SERVER_ERROR' });
    }
  }

  if (pathname === '/api/quotes/mine' && method === 'GET') {
    if (!ensureAuthenticated(res, sessionContext, ['contractor'])) return true;
    const contractor = store.listContractors().find((entry) => entry.userId === sessionContext.user.id);
    if (!contractor) {
      return sendJson(res, 200, { quotes: [] });
    }
    const quotes = store.listQuotes({ contractorId: contractor.id }).map((quote) => publicQuote(quote, store));
    return sendJson(res, 200, { quotes });
  }

  if (pathname.startsWith('/api/quotes/') && pathname.endsWith('/status') && method === 'POST') {
    if (!ensureAuthenticated(res, sessionContext, ['homeowner', 'property_manager'])) return true;
    const quoteId = Number.parseInt(pathname.split('/')[3], 10);
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const { status } = body;
    if (!['submitted', 'approved', 'declined'].includes(status)) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    try {
      const quote = await store.setQuoteStatus(quoteId, status);
      if (status === 'approved') {
        await store.updateProjectStatus(quote.projectId, 'in_escrow');
      }
      return sendJson(res, 200, { quote: publicQuote(quote, store) });
    } catch (error) {
      if (error.message === 'NOT_FOUND') {
        return sendJson(res, 404, { error: 'NOT_FOUND' });
      }
      return sendJson(res, 500, { error: 'SERVER_ERROR' });
    }
  }

  if (pathname === '/api/quotes/for-projects' && method === 'GET') {
    if (!ensureAuthenticated(res, sessionContext, ['homeowner', 'property_manager'])) return true;
    const myProjects = store.listProjects({ clientId: sessionContext.user.id });
    const projectIds = new Set(myProjects.map((project) => project.id));
    const quotes = store
      .listQuotes()
      .filter((quote) => projectIds.has(quote.projectId))
      .map((quote) => publicQuote(quote, store));
    return sendJson(res, 200, { quotes });
  }

  return false;
}

async function handleAdminRoutes(req, res, pathname, method, store, sessionContext) {
  if (pathname === '/api/admin/overview' && method === 'GET') {
    if (!ensureAuthenticated(res, sessionContext, ['admin'])) return true;
    const summary = store.summarizePlatform();
    return sendJson(res, 200, summary);
  }

  return false;
}

async function handlePaymentRoutes(req, res, pathname, method, store, sessionContext) {
  if (pathname === '/api/payments/fund' && method === 'POST') {
    if (!ensureAuthenticated(res, sessionContext, ['homeowner', 'property_manager'])) return true;
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const projectId = Number.parseInt(body.projectId, 10);
    const milestoneId = Number.parseInt(body.milestoneId, 10);
    const amount = Number.parseFloat(body.amount);
    if (!Number.isFinite(projectId) || !Number.isFinite(milestoneId) || !Number.isFinite(amount) || amount <= 0) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    const project = store.findProjectById(projectId);
    if (!project || project.clientId !== sessionContext.user.id) {
      return sendJson(res, 403, { error: 'FORBIDDEN' });
    }
    if (!project.awardedContractorId) {
      return sendJson(res, 409, { error: 'CONTRACTOR_NOT_ASSIGNED' });
    }
    try {
      const payment = await store.createPayment({
        projectId,
        milestoneId,
        amount,
        payerId: sessionContext.user.id,
        payeeId: project.awardedContractorId,
        processor: body.processor || 'simulated'
      });
      return sendJson(res, 201, { payment: publicPayment(payment, store) });
    } catch (error) {
      if (['PROJECT_NOT_FOUND', 'MILESTONE_NOT_FOUND'].includes(error.message)) {
        return sendJson(res, 404, { error: error.message });
      }
      return sendJson(res, 500, { error: 'SERVER_ERROR' });
    }
  }

  if (pathname === '/api/payments/release' && method === 'POST') {
    if (!ensureAuthenticated(res, sessionContext, ['homeowner', 'property_manager', 'admin'])) return true;
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const paymentId = Number.parseInt(body.paymentId, 10);
    if (!Number.isFinite(paymentId)) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    try {
      const payment = await store.setPaymentStatus(paymentId, 'released', {
        releasedBy: sessionContext.user.id,
        releasedAt: new Date().toISOString()
      });
      return sendJson(res, 200, { payment: publicPayment(payment, store) });
    } catch (error) {
      if (error.message === 'NOT_FOUND') {
        return sendJson(res, 404, { error: 'NOT_FOUND' });
      }
      return sendJson(res, 500, { error: 'SERVER_ERROR' });
    }
  }

  if (pathname === '/api/payments' && method === 'GET') {
    if (!ensureAuthenticated(res, sessionContext, ['homeowner', 'property_manager', 'contractor', 'admin'])) return true;
    const search = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const filter = {};
    if (search.get('status')) filter.status = search.get('status');
    if (search.get('projectId')) filter.projectId = Number.parseInt(search.get('projectId'), 10);
    let payments = store.listPayments(filter);
    if (sessionContext.user.role === 'homeowner' || sessionContext.user.role === 'property_manager') {
      const myProjects = new Set(
        store
          .listProjects({ clientId: sessionContext.user.id })
          .map((project) => project.id)
      );
      payments = payments.filter((payment) => myProjects.has(payment.projectId));
    } else if (sessionContext.user.role === 'contractor') {
      const contractor = store.listContractors().find((entry) => entry.userId === sessionContext.user.id);
      if (!contractor) {
        payments = [];
      } else {
        payments = payments.filter((payment) => {
          const project = store.findProjectById(payment.projectId);
          return project?.awardedContractorId === contractor.id;
        });
      }
    }
    return sendJson(res, 200, { payments: payments.map((payment) => publicPayment(payment, store)) });
  }

  return false;
}

async function handleReviewRoutes(req, res, pathname, method, store, sessionContext) {
  if (pathname === '/api/reviews' && method === 'POST') {
    if (!ensureAuthenticated(res, sessionContext, ['homeowner', 'property_manager'])) return true;
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const projectId = Number.parseInt(body.projectId, 10);
    const contractorId = Number.parseInt(body.contractorId, 10);
    const rating = Number.parseInt(body.rating, 10);
    if (!Number.isFinite(projectId) || !Number.isFinite(contractorId) || !Number.isFinite(rating) || rating < 1 || rating > 5) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    const project = store.findProjectById(projectId);
    if (!project || project.clientId !== sessionContext.user.id) {
      return sendJson(res, 403, { error: 'FORBIDDEN' });
    }
    const review = await store.createReview({
      projectId,
      contractorId,
      clientId: sessionContext.user.id,
      rating,
      comment: body.comment?.trim() || ''
    });
    return sendJson(res, 201, { review: publicReview(review, store) });
  }

  if (pathname === '/api/reviews' && method === 'GET') {
    const search = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const filter = {};
    if (search.get('contractorId')) filter.contractorId = Number.parseInt(search.get('contractorId'), 10);
    if (search.get('status')) {
      filter.status = search.get('status');
    } else {
      filter.status = 'published';
    }
    const reviews = store.listReviews(filter).map((review) => publicReview(review, store));
    return sendJson(res, 200, { reviews });
  }

  if (pathname.startsWith('/api/reviews/') && pathname.endsWith('/status') && method === 'POST') {
    if (!ensureAuthenticated(res, sessionContext, ['admin'])) return true;
    const reviewId = Number.parseInt(pathname.split('/')[3], 10);
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const { status } = body;
    if (!['published', 'hidden'].includes(status)) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    try {
      const review = await store.setReviewStatus(reviewId, status);
      return sendJson(res, 200, { review: publicReview(review, store) });
    } catch (error) {
      if (error.message === 'NOT_FOUND') {
        return sendJson(res, 404, { error: 'NOT_FOUND' });
      }
      return sendJson(res, 500, { error: 'SERVER_ERROR' });
    }
  }

  return false;
}

async function handleVerificationRoutes(req, res, pathname, method, store, sessionContext) {
  if (pathname === '/api/verifications' && method === 'GET') {
    if (!ensureAuthenticated(res, sessionContext, ['admin'])) return true;
    const search = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const verifications = store
      .listVerifications({ status: search.get('status') || undefined })
      .map((record) => publicVerification(record, store));
    return sendJson(res, 200, { verifications });
  }

  if (pathname === '/api/verifications/documents' && method === 'POST') {
    if (!ensureAuthenticated(res, sessionContext, ['contractor'])) return true;
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const contractor = store.listContractors().find((entry) => entry.userId === sessionContext.user.id);
    if (!contractor) {
      return sendJson(res, 404, { error: 'NOT_FOUND' });
    }
    const record = await store.addVerificationDocument(contractor.id, {
      type: body.type || 'document',
      name: body.name || 'uploaded-file',
      url: body.url || null
    });
    return sendJson(res, 201, { verification: publicVerification(record, store) });
  }

  if (pathname.startsWith('/api/verifications/') && pathname.endsWith('/status') && method === 'POST') {
    if (!ensureAuthenticated(res, sessionContext, ['admin'])) return true;
    const contractorId = Number.parseInt(pathname.split('/')[3], 10);
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const { status, notes } = body;
    if (!['pending', 'approved', 'declined'].includes(status)) {
      return sendJson(res, 400, { error: 'VALIDATION_ERROR' });
    }
    const contractor = store.data.contractors.find((entry) => entry.id === contractorId);
    if (!contractor) {
      return sendJson(res, 404, { error: 'NOT_FOUND' });
    }
    const record = await store.updateVerification(contractorId, {
      status,
      notes: notes ? [notes] : undefined
    });
    const contractorStatus = status === 'approved' ? 'approved' : status === 'declined' ? 'declined' : 'pending';
    await store.setContractorStatus(contractorId, contractorStatus);
    return sendJson(res, 200, { verification: publicVerification(record, store) });
  }

  return false;
}

async function handleDirectoryRoutes(req, res, pathname, method, store) {
  if (pathname === '/api/directory/contractors' && method === 'GET') {
    const search = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const contractors = store
      .listContractors({
        status: search.get('verified') === 'true' ? 'approved' : undefined,
        trade: search.get('trade') || undefined,
        province: search.get('province') || undefined,
        city: search.get('city') || undefined,
        premium: search.get('premium') === 'true'
      })
      .map((contractor) => publicContractor(contractor, store));
    return sendJson(res, 200, { contractors });
  }
  return false;
}

async function handleChatbotRoutes(req, res, pathname, method) {
  if (pathname === '/api/chatbot/kee' && method === 'POST') {
    let body;
    try {
      body = await readRequestBody(req);
    } catch (error) {
      return sendJson(res, 400, { error: 'INVALID_JSON' });
    }
    const intent = (body.intent || '').toLowerCase();
    const responses = {
      onboarding:
        'To get started, create an UpKept account, add your project, and Kee will connect you with verified professionals.',
      escrow:
        'Your funds stay in escrow until milestones are approved. Release happens only with your confirmation.',
      support: 'Our Canadian support team is available 24/7 at support@upkept.ca or through live chat.'
    };
    const message =
      responses[intent] ||
      'Hi! I am Kee, your UpKept assistant. Ask about finding contractors, escrow protection, or getting support.';
    const actions = [
      { label: 'Submit a Project', href: '/submit-project.html' },
      { label: 'Learn About Escrow', href: '/escrow.html' },
      { label: 'Apply as Contractor', href: '/apply.html' }
    ];
    return sendJson(res, 200, { message, actions });
  }
  return false;
}

export async function createApp() {
  const store = new DataStore(process.env.UPKEPT_DATA_PATH);
  await store.init();

  return async (req, res) => {
    const method = req.method || 'GET';
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const pathname = parsedUrl.pathname;

    const cookies = parseCookies(req.headers.cookie || '');
    const session = cookies.upkept_session ? store.getSession(cookies.upkept_session) : null;
    const user = session ? store.findUserById(session.userId) : null;
    const sessionContext = { session, user };

    if (pathname.startsWith('/api/')) {
      const handledAuth = await handleAuthRoutes(req, res, pathname, method, store, sessionContext);
      if (handledAuth) return;
      const handledProjects = await handleProjectsRoutes(req, res, pathname, method, store, sessionContext);
      if (handledProjects) return;
      const handledContractors = await handleContractorRoutes(req, res, pathname, method, store, sessionContext);
      if (handledContractors) return;
      const handledQuotes = await handleQuoteRoutes(req, res, pathname, method, store, sessionContext);
      if (handledQuotes) return;
      const handledAdmin = await handleAdminRoutes(req, res, pathname, method, store, sessionContext);
      if (handledAdmin) return;
      const handledPayments = await handlePaymentRoutes(req, res, pathname, method, store, sessionContext);
      if (handledPayments) return;
      const handledReviews = await handleReviewRoutes(req, res, pathname, method, store, sessionContext);
      if (handledReviews) return;
      const handledVerifications = await handleVerificationRoutes(req, res, pathname, method, store, sessionContext);
      if (handledVerifications) return;
      const handledDirectory = await handleDirectoryRoutes(req, res, pathname, method, store);
      if (handledDirectory) return;
      const handledChatbot = await handleChatbotRoutes(req, res, pathname, method);
      if (handledChatbot) return;
      return sendJson(res, 404, { error: 'NOT_FOUND' });
    }

    if (method !== 'GET') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    await serveStatic(req, res, pathname === '/' ? '/index.html' : pathname);
  };
}

export async function startServer(port = Number.parseInt(process.env.PORT || '3000', 10)) {
  const handler = await createApp();
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(port, () => {
      const address = server.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      resolve({ server, port: resolvedPort });
    });
  });
}
