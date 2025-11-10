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
    reviews: 0,
    payments: 0,
    verifications: 0,
    disputes: 0,
    messages: 0,
    milestones: 0,
    blogPosts: 0
    reviews: 0
  },
  users: [],
  contractors: [],
  projects: [],
  quotes: [],
  reviews: [],
  payments: [],
  verifications: [],
  disputes: [],
  messages: [],
  blogPosts: []
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

  async createContractorProfile({
    userId,
    companyName,
    trades,
    province,
    city,
    summary,
    yearsInBusiness,
    isPremium = false
  }) {
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
        isPremium,
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
      isPremium,
      status: 'pending',
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.data.contractors.push(contractor);
    await this.ensureVerification(contractor.id);
    await this.#persist();
    return contractor;
  }

  listContractors(filter = {}) {
    const { status } = filter;
    return this.data.contractors
      .filter((contractor) => {
        if (status && contractor.status !== status) return false;
        if (filter.province && contractor.province !== filter.province) return false;
        if (filter.city && contractor.city !== filter.city) return false;
        if (filter.trade && !contractor.trades?.includes(filter.trade)) return false;
        if (filter.premium === true && !contractor.isPremium) return false;
        return true;
      })
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

  #createMilestone(milestone) {
    const id = this.#nextId('milestones');
    return {
      id,
      title: milestone.title || 'Milestone',
      description: milestone.description || '',
      amount: Number.parseFloat(milestone.amount || 0) || 0,
      dueDate: milestone.dueDate || null,
      status: milestone.status || 'pending',
      createdAt: this.#timestamp(),
      updatedAt: this.#timestamp()
    };
  }

  async createProject({ clientId, title, scope, budget, timeline, city, province, tradeType, milestones = [] }) {
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
      milestones: milestones.map((milestone) => this.#createMilestone(milestone)),
      escrow: { funded: false, releasedMilestones: [] },
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
      if (filter.tradeType && project.tradeType !== filter.tradeType) return false;
      if (filter.city && project.city !== filter.city) return false;
      if (filter.province && project.province !== filter.province) return false;
      return true;
    });
  }

  findProjectById(id) {
    return this.data.projects.find((project) => project.id === id) || null;
  }

  findMilestone(projectId, milestoneId) {
    const project = this.findProjectById(projectId);
    if (!project) return null;
    return project.milestones.find((milestone) => milestone.id === milestoneId) || null;
  }

  async setMilestoneStatus(projectId, milestoneId, status) {
    const project = this.findProjectById(projectId);
    if (!project) throw new Error('NOT_FOUND');
    const milestone = project.milestones.find((entry) => entry.id === milestoneId);
    if (!milestone) throw new Error('NOT_FOUND');
    milestone.status = status;
    milestone.updatedAt = this.#timestamp();
    await this.#persist();
    return { project, milestone };
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

  async ensureVerification(contractorId) {
    let record = this.data.verifications.find((entry) => entry.contractorId === contractorId);
    if (!record) {
      const id = this.#nextId('verifications');
      const timestamp = this.#timestamp();
      record = {
        id,
        contractorId,
        status: 'pending',
        documents: [],
        references: [],
        notes: [],
        createdAt: timestamp,
        updatedAt: timestamp
      };
      this.data.verifications.push(record);
      await this.#persist();
    }
    return record;
  }

  async updateVerification(contractorId, payload = {}) {
    const record = await this.ensureVerification(contractorId);
    const { notes, ...rest } = payload;
    if (notes) {
      const notesArray = Array.isArray(notes) ? notes : [notes];
      record.notes = [...(record.notes || []), ...notesArray];
    }
    Object.assign(record, rest, { updatedAt: this.#timestamp() });
    await this.#persist();
    return record;
  }

  listVerifications(filter = {}) {
    return this.data.verifications.filter((record) => {
      if (filter.status && record.status !== filter.status) return false;
      return true;
    });
  }

  async addVerificationDocument(contractorId, document) {
    const record = await this.ensureVerification(contractorId);
    record.documents.push({ ...document, uploadedAt: this.#timestamp() });
    record.updatedAt = this.#timestamp();
    await this.#persist();
    return record;
  }

  async createPayment({ projectId, milestoneId, amount, currency = 'CAD', payerId, payeeId, processor = 'simulated' }) {
    const project = this.findProjectById(projectId);
    if (!project) throw new Error('PROJECT_NOT_FOUND');
    const milestone = this.findMilestone(projectId, milestoneId);
    if (!milestone) throw new Error('MILESTONE_NOT_FOUND');
    const id = this.#nextId('payments');
    const timestamp = this.#timestamp();
    const numericAmount = Number.parseFloat(amount || 0);
    const payment = {
      id,
      projectId,
      milestoneId,
      amount: Number.isFinite(numericAmount) ? numericAmount : 0,
      currency,
      payerId,
      payeeId,
      processor,
      status: 'funded',
      commission: 0,
      escrowFee: 0,
      netPayout: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    this.data.payments.push(payment);
    project.escrow.funded = true;
    milestone.status = 'funded';
    milestone.updatedAt = timestamp;
    await this.#persist();
    return payment;
  }

  listPayments(filter = {}) {
    return this.data.payments.filter((payment) => {
      if (filter.projectId && payment.projectId !== filter.projectId) return false;
      if (filter.status && payment.status !== filter.status) return false;
      return true;
    });
  }

  async setPaymentStatus(id, status, metadata = {}) {
    const payment = this.data.payments.find((entry) => entry.id === id);
    if (!payment) throw new Error('NOT_FOUND');
    payment.status = status;
    payment.updatedAt = this.#timestamp();
    if (status === 'released') {
      const commission = payment.amount * 0.1;
      const escrowFee = payment.amount * 0.02;
      payment.commission = commission;
      payment.escrowFee = escrowFee;
      payment.netPayout = payment.amount - commission;
    }
    payment.metadata = { ...payment.metadata, ...metadata };
    const project = this.findProjectById(payment.projectId);
    if (project) {
      const milestone = this.findMilestone(payment.projectId, payment.milestoneId);
      if (milestone) {
        milestone.status = status === 'released' ? 'released' : milestone.status;
        milestone.updatedAt = this.#timestamp();
        if (status === 'released') {
          project.escrow.releasedMilestones.push(payment.milestoneId);
        }
      }
      if (status === 'released' && project.milestones.every((entry) => entry.status === 'released')) {
        project.status = 'completed';
        project.updatedAt = this.#timestamp();
      }
    }
    await this.#persist();
    return payment;
  }

  async createReview({ projectId, contractorId, clientId, rating, comment }) {
    const id = this.#nextId('reviews');
    const timestamp = this.#timestamp();
    const review = {
      id,
      projectId,
      contractorId,
      clientId,
      rating,
      comment,
      status: 'published',
      createdAt: timestamp
    };
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
      if (filter.status && review.status !== filter.status) return false;
      return true;
    });
  }

  async setReviewStatus(id, status) {
    const review = this.data.reviews.find((entry) => entry.id === id);
    if (!review) throw new Error('NOT_FOUND');
    review.status = status;
    review.updatedAt = this.#timestamp();
    await this.#persist();
    return review;
  }

  summarizePlatform() {
    const projectsInEscrow = this.data.projects.filter((project) => project.status === 'in_escrow').length;
    const completedProjects = this.data.projects.filter((project) => project.status === 'completed').length;
    const activeQuotes = this.data.quotes.filter((quote) => quote.status === 'submitted').length;
    const approvedContractors = this.data.contractors.filter((contractor) => contractor.status === 'approved').length;
    const escrowVolume = this.data.payments
      .filter((payment) => ['funded', 'released'].includes(payment.status))
      .reduce((total, payment) => total + payment.amount, 0);
    const releasedVolume = this.data.payments
      .filter((payment) => payment.status === 'released')
      .reduce((total, payment) => total + payment.amount, 0);
    const commission = this.data.payments
      .filter((payment) => payment.status === 'released')
      .reduce((total, payment) => total + (payment.commission || payment.amount * 0.1), 0);
    const escrowFees = this.data.payments
      .filter((payment) => payment.status === 'released')
      .reduce((total, payment) => total + (payment.escrowFee || payment.amount * 0.02), 0);
    return {
      totals: {
        users: this.data.users.length,
        contractors: this.data.contractors.length,
        projects: this.data.projects.length,
        quotes: this.data.quotes.length,
        reviews: this.data.reviews.length,
        payments: this.data.payments.length
        quotes: this.data.quotes.length
      },
      metrics: {
        projectsInEscrow,
        completedProjects,
        activeQuotes,
        approvedContractors,
        premiumContractors: this.data.contractors.filter((contractor) => contractor.isPremium).length,
        escrowVolume,
        releasedVolume,
        commission,
        escrowFees
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
