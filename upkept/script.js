const navToggle = document.querySelector('.nav-toggle');
const navLinks = document.querySelector('.nav-links');
const chatLaunch = document.querySelector('.chat-launch');
const chatbot = document.querySelector('[data-chatbot]');
const chatClose = document.querySelector('.chatbot-close');
const chatbotOptions = document.querySelectorAll('.chatbot-options li');
const chatbotForm = document.querySelector('.chatbot-form');
const chatbotInput = document.querySelector('#chatbot-input');

if (navToggle) {
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
        if (destination.startsWith('mailto:')) {
          window.location.href = destination;
        } else {
          window.location.href = destination;
        }
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
    responseBox.innerHTML = `<strong>Kee:</strong> Thanks! I’ve shared your request with our support team. You can also explore the <a href="client-portal.html">Client Portal</a> or <a href="contractor-portal.html">Contractor Portal</a> for next steps.`;
    chatbotForm.parentElement.insertBefore(responseBox, chatbotForm);
    chatbotInput.value = '';
  });
}

// Close chatbot when clicking outside
if (chatbot) {
  document.addEventListener('click', (event) => {
    if (!chatbot.contains(event.target) && event.target !== chatLaunch) {
      chatbot.classList.remove('is-visible');
    }
  });
}
