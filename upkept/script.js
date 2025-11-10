const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
const chatLaunch = document.querySelector('.chat-launch');
const chatbot = document.querySelector('[data-chatbot]');
const chatClose = document.querySelector('.chatbot-close');
const chatbotOptions = document.querySelectorAll('.chatbot-options li');
const chatbotForm = document.querySelector('.chatbot-form');
const chatbotInput = document.querySelector('#chatbot-input');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
}

if (chatLaunch && chatbot) {
  chatLaunch.addEventListener('click', () => {
    chatbot.classList.add('is-visible');
    chatbotInput?.focus();
  });
}

if (chatClose && chatbot) {
  chatClose.addEventListener('click', () => {
    chatbot.classList.remove('is-visible');
  });
}

if (chatbotOptions.length) {
  chatbotOptions.forEach((option) => {
    option.addEventListener('click', () => {
      const destination = option.getAttribute('data-link');
      if (destination) {
        window.location.href = destination;
      }
    });
  });
}

if (chatbotForm) {
  chatbotForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const message = chatbotInput.value.trim();
    if (!message) return;

    const responseBox = document.createElement('div');
    responseBox.className = 'chatbot-secondary';
    responseBox.innerHTML =
      '<strong>Kee:</strong> Thanks! I’ve shared your request with our support team. You can also explore the <a href="client-portal.html">Client Portal</a> or <a href="contractor-portal.html">Contractor Portal</a> for next steps.';
    chatbotForm.parentElement.insertBefore(responseBox, chatbotForm);
    chatbotInput.value = '';
  });
}

if (chatbot) {
  document.addEventListener('click', (event) => {
    if (!chatbot.contains(event.target) && event.target !== chatLaunch) {
      chatbot.classList.remove('is-visible');
    }
  });
}

const sessionState = { user: null, ready: false };

function ensureNavAccountSlot() {
  if (!navLinks) return null;
  let container = navLinks.querySelector('.nav-account');
  if (!container) {
    container = document.createElement('div');
    container.className = 'nav-account';
    navLinks.appendChild(container);
  }
  return container;
}

function renderAuthControls(user) {
  const container = ensureNavAccountSlot();
  if (!container) return;
  container.innerHTML = '';
  if (!user) {
    const loginLink = document.createElement('a');
    loginLink.href = 'login.html';
    loginLink.className = 'btn-outline nav-login';
    loginLink.textContent = 'Sign In';
    container.appendChild(loginLink);
    return;
  }
  const name = document.createElement('span');
  name.className = 'nav-user';
  name.textContent = user.name || 'Account';
  container.appendChild(name);

  const logoutButton = document.createElement('button');
  logoutButton.type = 'button';
  logoutButton.className = 'btn-secondary nav-logout';
  logoutButton.textContent = 'Log Out';
  logoutButton.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (error) {
      console.error('Unable to log out', error);
    }
    sessionState.user = null;
    dispatchSessionChange(null);
  });
  container.appendChild(logoutButton);
}

function dispatchSessionChange(user) {
  renderAuthControls(user);
  applyRoleGuards(user);
  populateSessionBadges(user);
  hydrateDashboards(user);
  document.dispatchEvent(new CustomEvent('upkept:session-change', { detail: user }));
}

async function loadSession() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    if (!response.ok) throw new Error('Failed to fetch session');
    const payload = await response.json();
    sessionState.user = payload.user || null;
  } catch (error) {
    sessionState.user = null;
  } finally {
    sessionState.ready = true;
    dispatchSessionChange(sessionState.user);
  }
}

function getRoleList(element) {
  return (element.dataset.requiresRole || '')
    .split(',')
    .map((role) => role.trim())
    .filter(Boolean);
}

function applyRoleGuards(user) {
  document.querySelectorAll('[data-requires-role]').forEach((element) => {
    const allowedRoles = getRoleList(element);
    const isAllowed = user && (!allowedRoles.length || allowedRoles.includes(user.role));
    element.classList.toggle('is-locked', !isAllowed);
    element.querySelectorAll('input, textarea, select, button').forEach((field) => {
      if (field.dataset.keepEnabled === 'true') return;
      field.disabled = !isAllowed && field.tagName !== 'A';
    });
    const message = element.querySelector('[data-role-locked]');
    if (message) {
      message.hidden = isAllowed;
    }
  });
}

function populateSessionBadges(user) {
  document.querySelectorAll('[data-session-name]').forEach((element) => {
    element.textContent = user?.name || 'Guest';
  });
  document.querySelectorAll('[data-session-email]').forEach((element) => {
    element.textContent = user?.email || 'Sign in to view';
  });
  document.querySelectorAll('[data-session-role]').forEach((element) => {
    element.textContent = user?.role ? user.role.replace('_', ' ') : 'Not signed in';
  });
}

function ensureFeedbackElement(form) {
  let message = form.querySelector('[data-form-feedback]');
  if (!message) {
    message = document.createElement('p');
    message.className = 'form-feedback';
    message.dataset.formFeedback = '';
    form.insertBefore(message, form.firstChild);
  }
  return message;
}

function translateError(code) {
  const messages = {
    INVALID_JSON: 'We were unable to read your request. Please try again.',
    VALIDATION_ERROR: 'Please review the required fields and try again.',
    EMAIL_IN_USE: 'That email is already registered with UpKept.',
    INVALID_CREDENTIALS: 'The email or password did not match our records.',
    UNAUTHENTICATED: 'Sign in to continue.',
    FORBIDDEN: 'You do not have permission to complete this action.',
    CONTRACTOR_PROFILE_REQUIRED: 'Create your contractor profile before submitting quotes.',
    PROJECT_NOT_FOUND: 'The selected project could not be found.',
    NOT_FOUND: 'The requested record does not exist.'
  };
  return messages[code] || 'Something went wrong. Please try again.';
}

function buildPayloadFromForm(form) {
  const formData = new FormData(form);
  const payload = {};
  for (const key of formData.keys()) {
    const values = formData.getAll(key).filter((value) => typeof value === 'string');
    if (!values.length) continue;
    if (values.length === 1) {
      payload[key] = values[0].trim();
    } else {
      payload[key] = values.map((value) => value.trim()).filter(Boolean);
    }
  }
  return payload;
}

async function handleApiFormSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const endpoint = form.dataset.apiEndpoint;
  if (!endpoint) return;
  const method = (form.dataset.apiMethod || 'POST').toUpperCase();
  const feedback = ensureFeedbackElement(form);
  feedback.hidden = true;
  feedback.classList.remove('is-error', 'is-success');

  const submitButton = form.querySelector('button[type="submit"], input[type="submit"]');
  if (submitButton) {
    submitButton.disabled = true;
  }

  try {
    const payload = buildPayloadFromForm(form);
    const response = await fetch(endpoint, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: method === 'GET' ? undefined : JSON.stringify(payload)
    });
    let body = {};
    try {
      body = await response.json();
    } catch (error) {
      body = {};
    }
    if (!response.ok) {
      const message = translateError(body.error);
      feedback.textContent = message;
      feedback.classList.add('is-error');
      feedback.hidden = false;
      return;
    }

    if (body.user) {
      sessionState.user = body.user;
      dispatchSessionChange(sessionState.user);
    }

    feedback.textContent = form.dataset.successMessage || 'Success!';
    feedback.classList.add('is-success');
    feedback.hidden = false;

    if (form.dataset.resetOnSuccess !== 'false') {
      form.reset();
    }

    document.dispatchEvent(new CustomEvent('upkept:data-updated'));

    if (body.user && form.dataset.redirectMap) {
      try {
        const redirectMap = JSON.parse(form.dataset.redirectMap);
        const target = redirectMap && redirectMap[body.user.role];
        if (target) {
          window.location.href = target;
          return;
        }
      } catch (error) {
        console.warn('Unable to parse redirect map', error);
      }
    }

    const redirect = form.dataset.successRedirect;
    if (redirect) {
      window.location.href = redirect;
    }
  } catch (error) {
    console.error('Form submission failed', error);
    feedback.textContent = 'Something went wrong. Please try again.';
    feedback.classList.add('is-error');
    feedback.hidden = false;
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
    }
  }
}

function initApiForms() {
  document.querySelectorAll('[data-api-endpoint]').forEach((form) => {
    form.addEventListener('submit', handleApiFormSubmit);
  });
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return await response.json();
}

function emptyList(target, message) {
  const element = target;
  if (!element) return;
  element.innerHTML = '';
  const item = document.createElement('li');
  item.className = 'muted';
  item.textContent = message;
  element.appendChild(item);
}

function renderContractors(target, contractors) {
  if (!target) return;
  target.innerHTML = '';
  if (!contractors.length) {
    emptyList(target, 'Contractor matches will appear once applications are approved.');
    return;
  }
  contractors.slice(0, 5).forEach((contractor) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = contractor.companyName || contractor.contactName || 'Contractor';
    details.appendChild(name);
    const tag = document.createElement('div');
    tag.className = 'tag';
    const location = [contractor.city, contractor.province].filter(Boolean).join(', ');
    tag.textContent = `${contractor.status === 'approved' ? 'Verified' : 'Pending'}${location ? ` • ${location}` : ''}`;
    details.appendChild(tag);
    item.appendChild(details);
    const link = document.createElement('a');
    link.className = 'btn-secondary';
    link.href = 'contractor-profile.html';
    link.textContent = 'View Profile';
    item.appendChild(link);
    target.appendChild(item);
  });
}

function renderProjects(target, projects, { emptyMessage = 'No projects yet.', includeStatus = false } = {}) {
  if (!target) return;
  target.innerHTML = '';
  if (!projects.length) {
    emptyList(target, emptyMessage);
    return;
  }
  projects.forEach((project) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    const title = document.createElement('span');
    title.textContent = project.title || 'Project';
    details.appendChild(title);
    if (includeStatus) {
      const status = document.createElement('div');
      status.className = 'tag';
      status.textContent = project.status.replace('_', ' ');
      details.appendChild(status);
    }
    if (project.timeline) {
      const meta = document.createElement('div');
      meta.className = 'muted';
      meta.textContent = project.timeline;
      details.appendChild(meta);
    }
    item.appendChild(details);
    target.appendChild(item);
  });
}

function renderQuoteList(target, quotes, projectMap) {
  if (!target) return;
  target.innerHTML = '';
  if (!quotes.length) {
    emptyList(target, 'Quotes will appear once contractors respond.');
    return;
  }
  quotes.forEach((quote) => {
    const item = document.createElement('li');
    const info = document.createElement('div');
    const project = projectMap.get(quote.projectId);
    const projectName = project?.title ? `${project.title}` : `Project #${quote.projectId}`;
    const contractorName = quote.contractor?.companyName || quote.contractor?.contactName || 'Contractor';
    info.innerHTML = `<span>${projectName} — ${quote.amount}</span><div class="muted">${contractorName}</div>`;
    item.appendChild(info);
    const actions = document.createElement('div');
    if (quote.status === 'submitted') {
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'btn';
      approve.dataset.quoteAction = 'approved';
      approve.dataset.quoteId = quote.id;
      approve.textContent = 'Accept Quote';
      actions.appendChild(approve);
      const decline = document.createElement('button');
      decline.type = 'button';
      decline.className = 'btn-secondary';
      decline.dataset.quoteAction = 'declined';
      decline.dataset.quoteId = quote.id;
      decline.textContent = 'Decline';
      actions.appendChild(decline);
    } else {
      const status = document.createElement('span');
      status.className = 'status-pill';
      status.textContent = quote.status.replace('_', ' ');
      actions.appendChild(status);
    }
    item.appendChild(actions);
    target.appendChild(item);
  });
}

function renderContractorProjects(target, projects, emptyMessage = 'No active projects yet. Accepted quotes will appear here.') {
  if (!target) return;
  target.innerHTML = '';
  if (!projects.length) {
    emptyList(target, emptyMessage);
    return;
  }
  projects.forEach((project) => {
    const item = document.createElement('li');
    const details = document.createElement('div');
    details.innerHTML = `<span>${project.title}</span><div class="tag">${project.status.replace('_', ' ')}</div>`;
    item.appendChild(details);
    const action = document.createElement('a');
    action.className = 'btn';
    action.href = 'project-timeline.html';
    action.textContent = 'View Project Timeline';
    item.appendChild(action);
    target.appendChild(item);
  });
}

async function hydrateClientDashboard(user) {
  const projectsList = document.querySelector('[data-client-projects]');
  const quotesList = document.querySelector('[data-client-quotes]');
  const activeList = document.querySelector('[data-client-active]');
  const completeList = document.querySelector('[data-client-completed]');
  const recommendations = document.querySelector('[data-client-recommendations]');

  if (!projectsList && !quotesList && !activeList && !completeList && !recommendations) return;

  if (!user || !['homeowner', 'property_manager'].includes(user.role)) {
    [projectsList, quotesList, activeList, completeList, recommendations].forEach((target) => {
      if (target) emptyList(target, 'Sign in with a client account to view details.');
    });
    return;
  }

  try {
    const [{ projects }, { quotes }] = await Promise.all([
      fetchJson('/api/projects/mine'),
      fetchJson('/api/quotes/for-projects')
    ]);

    const projectMap = new Map(projects.map((project) => [project.id, project]));

    renderProjects(projectsList, projects, {
      emptyMessage: 'Submit your first project to get matched with UpKept contractors.',
      includeStatus: true
    });

    renderQuoteList(quotesList, quotes, projectMap);

    const activeProjects = projects.filter((project) => project.status === 'in_escrow');
    renderProjects(activeList, activeProjects, {
      emptyMessage: 'Approved quotes will move here once escrow is funded.',
      includeStatus: true
    });

    const completedProjects = projects.filter((project) => project.status === 'completed');
    renderProjects(completeList, completedProjects, {
      emptyMessage: 'Completed projects will appear with their escrow summaries.'
    });

    if (recommendations) {
      let { contractors } = await fetchJson('/api/contractors?status=approved').catch(() => ({ contractors: [] }));
      if (!contractors.length) {
        ({ contractors } = await fetchJson('/api/contractors').catch(() => ({ contractors: [] })));
      }
      renderContractors(recommendations, contractors);
    }
  } catch (error) {
    console.error('Unable to hydrate client dashboard', error);
    [projectsList, quotesList, activeList, completeList, recommendations].forEach((target) => {
      if (target) emptyList(target, 'We could not load data. Please refresh to try again.');
    });
  }
}

async function hydrateContractorDashboard(user) {
  const availableProjectsList = document.querySelector('[data-contractor-available]');
  const quoteRequestsList = document.querySelector('[data-contractor-requests]');
  const quotesList = document.querySelector('[data-contractor-quotes]');
  const activeProjectsList = document.querySelector('[data-contractor-active-projects]');
  const completedProjectsList = document.querySelector('[data-contractor-completed]');
  const profileStatus = document.querySelector('[data-contractor-status]');

  if (!availableProjectsList && !quoteRequestsList && !quotesList && !activeProjectsList && !completedProjectsList && !profileStatus) return;

  if (!user || user.role !== 'contractor') {
    [availableProjectsList, quoteRequestsList, quotesList, activeProjectsList, completedProjectsList].forEach((target) => {
      if (target) emptyList(target, 'Sign in with a contractor account to view projects.');
    });
    if (profileStatus) {
      profileStatus.textContent = 'Not signed in';
    }
    return;
  }

  try {
    const [{ projects: openProjects }, { quotes }, { projects: assignedProjects }, { contractors }] = await Promise.all([
      fetchJson('/api/projects/open'),
      fetchJson('/api/quotes/mine').catch(() => ({ quotes: [] })),
      fetchJson('/api/projects/assigned').catch(() => ({ projects: [] })),
      fetchJson('/api/contractors').catch(() => ({ contractors: [] }))
    ]);

    const myProfile = contractors.find((contractor) => contractor.contactEmail === user.email);
    if (profileStatus) {
      profileStatus.textContent = myProfile ? myProfile.status : 'Profile not submitted';
    }

    const renderAvailable = (target, projects) => {
      if (!target) return;
      target.innerHTML = '';
      if (!projects.length) {
        emptyList(target, 'No open projects match your filters yet.');
        return;
      }
      projects.forEach((project) => {
        const item = document.createElement('li');
        const info = document.createElement('span');
        const location = [project.city, project.province].filter(Boolean).join(', ');
        info.textContent = `${location ? `${location} • ` : ''}${project.title}`;
        item.appendChild(info);
        const action = document.createElement('a');
        action.className = 'btn-secondary';
        action.href = `quote-submit.html?projectId=${project.id}`;
        action.textContent = 'View Project Details';
        item.appendChild(action);
        target.appendChild(item);
      });
    };

    renderAvailable(availableProjectsList, openProjects);
    renderAvailable(quoteRequestsList, openProjects.slice(0, 3));

    if (quotesList) {
      quotesList.innerHTML = '';
      if (!quotes.length) {
        emptyList(quotesList, 'Quotes you submit will appear here.');
      } else {
        quotes.forEach((quote) => {
          const item = document.createElement('li');
          const info = document.createElement('div');
          info.innerHTML = `<span>Project #${quote.projectId}</span><div class="muted">${quote.amount}</div>`;
          item.appendChild(info);
          const status = document.createElement('span');
          status.className = 'status-pill';
          status.textContent = quote.status.replace('_', ' ');
          item.appendChild(status);
          quotesList.appendChild(item);
        });
      }
    }

    const activeProjects = assignedProjects.filter((project) => project.status !== 'completed');
    renderContractorProjects(activeProjectsList, activeProjects);

    const completedProjects = assignedProjects.filter((project) => project.status === 'completed');
    renderContractorProjects(
      completedProjectsList,
      completedProjects,
      'Completed projects will appear once clients mark final milestones as approved.'
    );
  } catch (error) {
    console.error('Unable to hydrate contractor dashboard', error);
    [availableProjectsList, quoteRequestsList, quotesList, activeProjectsList, completedProjectsList].forEach((target) => {
      if (target) emptyList(target, 'We could not load contractor data.');
    });
    if (profileStatus) {
      profileStatus.textContent = 'Unavailable';
    }
  }
}

async function hydrateAdminDashboard(user) {
  const metricsList = document.querySelector('[data-admin-metrics]');
  const pendingList = document.querySelector('[data-admin-pending]');

  if (!metricsList && !pendingList) return;

  if (!user || user.role !== 'admin') {
    if (metricsList) emptyList(metricsList, 'Sign in with an admin account to view metrics.');
    if (pendingList) emptyList(pendingList, 'Sign in with an admin account to manage applications.');
    return;
  }

  try {
    const [summary, { contractors }] = await Promise.all([
      fetchJson('/api/admin/overview'),
      fetchJson('/api/contractors/applications').catch(() => ({ contractors: [] }))
    ]);

    if (metricsList) {
      metricsList.innerHTML = '';
      const metrics = [
        { label: 'Registered users', value: summary.totals.users },
        { label: 'Contractors', value: summary.totals.contractors },
        { label: 'Projects posted', value: summary.totals.projects },
        { label: 'Quotes submitted', value: summary.totals.quotes },
        { label: 'Active quotes', value: summary.metrics.activeQuotes },
        { label: 'Projects in escrow', value: summary.metrics.projectsInEscrow },
        { label: 'Completed projects', value: summary.metrics.completedProjects }
      ];
      metrics.forEach((metric) => {
        const item = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = metric.label;
        const value = document.createElement('span');
        value.className = 'status-pill';
        value.textContent = String(metric.value);
        item.append(label, value);
        metricsList.appendChild(item);
      });
    }

    if (pendingList) {
      pendingList.innerHTML = '';
      if (!contractors.length) {
        emptyList(pendingList, 'All contractor applications are up to date.');
      } else {
        contractors.forEach((contractor) => {
          const item = document.createElement('li');
          const info = document.createElement('div');
          info.innerHTML = `<strong>${contractor.companyName}</strong><div class="tag">${contractor.province || 'Unknown'} • ${
            contractor.trades || 'Trades pending'
          }</div>`;
          item.appendChild(info);
          const status = document.createElement('span');
          status.className = 'status-pill';
          status.textContent = contractor.status;
          item.appendChild(status);
          pendingList.appendChild(item);
        });
      }
    }
  } catch (error) {
    console.error('Unable to hydrate admin dashboard', error);
    if (metricsList) emptyList(metricsList, 'Metrics are temporarily unavailable.');
    if (pendingList) emptyList(pendingList, 'Pending applications could not be loaded.');
  }
}

function hydrateDashboards(user) {
  hydrateClientDashboard(user);
  hydrateContractorDashboard(user);
  hydrateAdminDashboard(user);
}

function initQuoteActions() {
  document.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-quote-action]');
    if (!action) return;
    const status = action.dataset.quoteAction;
    const quoteId = action.dataset.quoteId;
    if (!status || !quoteId) return;
    action.disabled = true;
    try {
      await fetch(`/api/quotes/${quoteId}/status`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ status })
      });
      document.dispatchEvent(new CustomEvent('upkept:data-updated'));
    } catch (error) {
      console.error('Unable to update quote status', error);
    } finally {
      action.disabled = false;
    }
  });
}

function initProjectIdPrefill() {
  const projectField = document.querySelector('[data-project-id-input]');
  if (!projectField) return;
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('projectId');
  if (projectId) {
    projectField.value = projectId;
  }
}

function initDataRefresh() {
  document.addEventListener('upkept:data-updated', () => {
    if (sessionState.user) {
      hydrateDashboards(sessionState.user);
    }
  });
}

initApiForms();
initQuoteActions();
initProjectIdPrefill();
initDataRefresh();
loadSession();
