import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultData = {
  counters: {
    users: 0,
    contractors: 0,
    projects: 0,
    quotes: 0,
    reviews: 0
  },
  users: [],
  contractors: [],
  projects: [],
  quotes: [],
  reviews: []
};

export class DataStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(__dirname, '..', 'data', 'upkept-data.json');
    this.data = structuredClone(defaultData);
    this.sessions = new Map();
  }

  async init() {
    if (this.filePath !== ':memory:') {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    }
    await this.#load();
  }

  async #load() {
    try {
      if (this.filePath === ':memory:') {
        this.data = structuredClone(defaultData);
        return;
      }
      const raw = await fs.readFile(this.filePath, 'utf8');
      this.data = { ...structuredClone(defaultData), ...JSON.parse(raw) };
    } catch (error) {
      this.data = structuredClone(defaultData);
      await this.#persist();
    }
  }

  async #persist() {
    if (this.filePath === ':memory:') {
      return;
    }
    const payload = JSON.stringify(this.data, null, 2);
    await fs.writeFile(this.filePath, payload, 'utf8');
  }

  async reset() {
    this.data = structuredClone(defaultData);
    this.sessions.clear();
    await this.#persist();
  }

  #nextId(key) {
    this.data.counters[key] += 1;
    return this.data.counters[key];
  }

  #publicUser(user) {
    if (!user) return null;
    const { id, name, email, role, createdAt } = user;
    return { id, name, email, role, createdAt };
  }

  #timestamp() {
    return new Date().toISOString();
  }

  async createUser({ name, email, passwordHash, role }) {
    const existing = this.data.users.find((user) => user.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      throw new Error('EMAIL_IN_USE');
    }
    const id = this.#nextId('users');
    const createdAt = this.#timestamp();
    const user = { id, name, email, passwordHash, role, createdAt };
    this.data.users.push(user);
    await this.#persist();
    return this.#publicUser(user);
  }

  findUserByEmail(email) {
    if (!email) return null;
    return this.data.users.find((user) => user.email.toLowerCase() === email.toLowerCase()) || null;
  }

  findUserById(id) {
    return this.data.users.find((user) => user.id === id) || null;
  }

  async createSession(userId) {
    const token = crypto.randomBytes(24).toString('hex');
    const session = { token, userId, createdAt: this.#timestamp() };
    this.sessions.set(token, session);
    return session;
  }

  destroySession(token) {
    if (!token) return;
    this.sessions.delete(token);
  }

  getSession(token) {
    if (!token) return null;
    return this.sessions.get(token) || null;
  }

  async createContractorProfile({ userId, companyName, trades, province, city, summary, yearsInBusiness }) {
    const existing = this.data.contractors.find((contractor) => contractor.userId === userId);
    const timestamp = this.#timestamp();
    if (existing) {
      Object.assign(existing, {
        companyName,
        trades,
        province,
        city,
        summary,
        yearsInBusiness,
        status: existing.status === 'approved' ? 'approved' : 'pending',
        updatedAt: timestamp
      });
      await this.#persist();
      return existing;
    }
    const id = this.#nextId('contractors');
    const contractor = {
      id,
      userId,
      companyName,
      trades,
      province,
      city,
      summary,
      yearsInBusiness,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.data.contractors.push(contractor);
    await this.#persist();
    return contractor;
  }

  listContractors(filter = {}) {
    const { status } = filter;
    return this.data.contractors
      .filter((contractor) => (status ? contractor.status === status : true))
      .map((contractor) => {
        const user = this.findUserById(contractor.userId);
        return {
          ...contractor,
          contactEmail: user?.email || null,
          contactName: user?.name || null
        };
      });
  }

  async setContractorStatus(contractorId, status) {
    const contractor = this.data.contractors.find((entry) => entry.id === contractorId);
    if (!contractor) {
      throw new Error('NOT_FOUND');
    }
    contractor.status = status;
    contractor.updatedAt = this.#timestamp();
    await this.#persist();
    return contractor;
  }

  async createProject({ clientId, title, scope, budget, timeline, city, province, tradeType }) {
    const id = this.#nextId('projects');
    const timestamp = this.#timestamp();
    const project = {
      id,
      clientId,
      title,
      scope,
      budget,
      timeline,
      city,
      province,
      tradeType,
      awardedContractorId: null,
      status: 'posted',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.data.projects.push(project);
    await this.#persist();
    return project;
  }

  listProjects(filter = {}) {
    return this.data.projects.filter((project) => {
      if (filter.clientId && project.clientId !== filter.clientId) return false;
      if (filter.status && project.status !== filter.status) return false;
      if (filter.contractorId && project.awardedContractorId !== filter.contractorId) return false;
      return true;
    });
  }

  findProjectById(id) {
    return this.data.projects.find((project) => project.id === id) || null;
  }

  async updateProjectStatus(id, status) {
    const project = this.findProjectById(id);
    if (!project) throw new Error('NOT_FOUND');
    project.status = status;
    project.updatedAt = this.#timestamp();
    await this.#persist();
    return project;
  }

  async createQuote({ projectId, contractorId, amount, message, timeline }) {
    if (!contractorId) {
      throw new Error('CONTRACTOR_REQUIRED');
    }
    const project = this.findProjectById(projectId);
    if (!project) {
      throw new Error('PROJECT_NOT_FOUND');
    }
    const id = this.#nextId('quotes');
    const timestamp = this.#timestamp();
    const quote = {
      id,
      projectId,
      contractorId,
      amount,
      message,
      timeline,
      status: 'submitted',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.data.quotes.push(quote);
    await this.#persist();
    return quote;
  }

  listQuotes(filter = {}) {
    return this.data.quotes.filter((quote) => {
      if (filter.projectId && quote.projectId !== filter.projectId) return false;
      if (filter.contractorId && quote.contractorId !== filter.contractorId) return false;
      if (filter.status && quote.status !== filter.status) return false;
      return true;
    });
  }

  async setQuoteStatus(id, status) {
    const quote = this.data.quotes.find((entry) => entry.id === id);
    if (!quote) throw new Error('NOT_FOUND');
    quote.status = status;
    quote.updatedAt = this.#timestamp();
    if (status === 'approved') {
      const project = this.findProjectById(quote.projectId);
      if (project) {
        project.status = 'in_escrow';
        project.awardedContractorId = quote.contractorId;
        project.updatedAt = this.#timestamp();
      }
    }
    await this.#persist();
    return quote;
  }

  async createReview({ projectId, contractorId, clientId, rating, comment }) {
    const id = this.#nextId('reviews');
    const timestamp = this.#timestamp();
    const review = { id, projectId, contractorId, clientId, rating, comment, createdAt: timestamp };
    this.data.reviews.push(review);
    await this.#persist();
    return review;
  }

  listReviews(filter = {}) {
    return this.data.reviews.filter((review) => {
      if (filter.contractorId && review.contractorId !== filter.contractorId) return false;
      if (filter.clientId && review.clientId !== filter.clientId) return false;
      return true;
    });
  }

  summarizePlatform() {
    const projectsInEscrow = this.data.projects.filter((project) => project.status === 'in_escrow').length;
    const completedProjects = this.data.projects.filter((project) => project.status === 'completed').length;
    const activeQuotes = this.data.quotes.filter((quote) => quote.status === 'submitted').length;
    const approvedContractors = this.data.contractors.filter((contractor) => contractor.status === 'approved').length;
    return {
      totals: {
        users: this.data.users.length,
        contractors: this.data.contractors.length,
        projects: this.data.projects.length,
        quotes: this.data.quotes.length
      },
      metrics: {
        projectsInEscrow,
        completedProjects,
        activeQuotes,
        approvedContractors
      }
    };
  }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  const [salt, hash] = storedHash.split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}
