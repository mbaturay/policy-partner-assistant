const DEMO_USER = {
	email: "compliance.officer@agency.gov",
	password: "password123",
	name: "Compliance Officer"
};

const STORAGE_KEYS = {
	user: "ppa_user",
	chats: "ppa_chats",
	messages: "ppa_messages",
	artifacts: "ppa_artifacts"
};

const PROMPT_LIBRARY = [
	{ id: "start-analysis", label: "Start a new compliance analysis" },
	{ id: "summarize-risks", label: "Summarize my high-risk tasks" },
	{ id: "explain-requirement", label: "Explain a policy requirement in plain language" }
];

const MESSAGE_TYPES = ["text", "upload-form", "recommendations", "tasks", "summary", "artifact-link"];

const PRIORITY_LEVELS = ["HIGH", "MEDIUM", "LOW"];
const ASSIGNEE_OPTIONS = ["HR", "Legal", "IT", "Operations", "Training"];

const state = {
	currentUser: null,
	chats: [],
	messages: [],
	tasks: [],
	prompts: PROMPT_LIBRARY,
	currentChatId: null,
	dom: {},
	flags: {
		chatFormBound: false,
		sidebarToggleBound: false
	}
};

const assistantArtifacts = [];
let activeArtifactId = null;

document.addEventListener("DOMContentLoaded", () => {
	cacheDom();
	bootstrapSession();
});

function cacheDom() {
	state.dom.app = document.getElementById("app");
	state.dom.sidebar = document.querySelector(".sidebar");
	state.dom.assistantLayout = document.querySelector(".assistant-layout");
	state.dom.chatList = document.getElementById("chat-list");
	state.dom.promptLibrary = document.getElementById("prompt-library");
	state.dom.chatTitle = document.getElementById("chat-title");
	state.dom.chatMessages = document.getElementById("chat-messages");
	state.dom.chatSuggestions = document.getElementById("chat-suggestions");
	state.dom.chatForm = document.querySelector(".chat-form");
	state.dom.chatInput = document.getElementById("chat-input");
	state.dom.newChatButton = document.querySelector(".sidebar__header .btn-primary");
	state.dom.sidebarToggle = document.querySelector(".sidebar-toggle");
	state.dom.workspacePanel = document.getElementById("assistant-workspace-panel");
}

function bootstrapSession() {
	hydrateArtifactsFromStorage();
	const storedUser = safeParse(localStorage.getItem(STORAGE_KEYS.user));
	if (storedUser?.email) {
		state.currentUser = storedUser;
		initApp();
	} else {
		showLoginModal();
	}
}

function showLoginModal() {
	hideLoginModal();
	const overlay = document.createElement("div");
	overlay.className = "login-overlay";
	overlay.innerHTML = `
		<div class="login-modal" role="dialog" aria-modal="true" aria-labelledby="login-title">
			<h2 id="login-title">Sign in to Policy Partner</h2>
			<p class="login-helper">Use the demo credentials to continue.</p>
			<form class="login-form">
				<label class="login-field">
					<span>Email</span>
					<input id="login-email" name="email" type="email" required placeholder="you@example.gov" />
				</label>
				<label class="login-field">
					<span>Password</span>
					<input id="login-password" name="password" type="password" required placeholder="Enter password" />
				</label>
				<p class="login-error" aria-live="polite"></p>
				<button class="btn btn-primary" type="submit">Sign in</button>
			</form>
			<p class="login-demo-hint">
				Demo user: ${DEMO_USER.email} / ${DEMO_USER.password}
			</p>
		</div>
	`;
	document.body.appendChild(overlay);
	state.dom.loginOverlay = overlay;
	const form = overlay.querySelector(".login-form");
	form.addEventListener("submit", handleLoginSubmit);
}

function hideLoginModal() {
	if (state.dom.loginOverlay) {
		state.dom.loginOverlay.remove();
		state.dom.loginOverlay = null;
	}
}

function handleLoginSubmit(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const email = form.email.value.trim().toLowerCase();
	const password = form.password.value;
	const errorEl = form.querySelector(".login-error");

	if (email === DEMO_USER.email && password === DEMO_USER.password) {
		const user = { email: DEMO_USER.email, name: DEMO_USER.name };
		state.currentUser = user;
		localStorage.setItem(STORAGE_KEYS.user, JSON.stringify(user));
		hideLoginModal();
		initApp();
	} else {
		errorEl.textContent = "Invalid credentials. Use the demo email and password.";
	}
}

async function initApp() {
	await loadDatabase();
	ensureCurrentChat();
	renderSidebar();
	renderChat();
	renderWorkspaceForActiveArtifact();
	wireEventHandlers();
}

async function loadDatabase() {
	try {
		const response = await fetch("db.json", { cache: "no-store" });
		if (!response.ok) {
			throw new Error(`Failed to load db.json (${response.status})`);
		}
		const payload = await response.json();
		hydrateState(payload);
	} catch (error) {
		console.error("Unable to load db.json:", error);
		hydrateState({});
	}
}

function hydrateState(payload) {
	const chatsFromPayload = Array.isArray(payload.chats) ? payload.chats : [];
	const messagesFromPayload = Array.isArray(payload.messages)
		? payload.messages
		: flattenMessagesFromChats(chatsFromPayload);
	state.chats = chatsFromPayload.map(normalizeChat);
	state.messages = messagesFromPayload.filter((msg) => msg.chatId).map(normalizeMessage);
	state.prompts = PROMPT_LIBRARY;
	mergeLocalChatState();
}

function ensureCurrentChat() {
	if (!state.chats.length) {
		createNewChat();
		return;
	}
	const hasExisting = state.currentChatId && state.chats.some((chat) => chat.id === state.currentChatId);
	if (hasExisting) {
		return;
	}
	const sorted = [...state.chats].sort((a, b) => new Date(a.updatedAt || a.createdAt) - new Date(b.updatedAt || b.createdAt));
	state.currentChatId = sorted.at(-1)?.id || state.chats[0].id;
}

function createNewChat() {
	const timestamp = new Date().toISOString();
	const chat = {
		id: uniqueId("chat_"),
		title: "New conversation",
		createdAt: timestamp,
		updatedAt: timestamp
	};
	state.chats.push(chat);
	state.currentChatId = chat.id;

	const greeting = {
		id: uniqueId("msg_"),
		chatId: chat.id,
		role: "assistant",
		type: "text",
		content: "Welcome back! I'm ready to help with your next policy task.",
		createdAt: timestamp
	};
	state.messages.push(greeting);
	persistChats();
	persistMessages();
	renderSidebar();
	renderChat();
	return chat;
}

function wireEventHandlers() {
	if (!state.flags.chatFormBound && state.dom.chatForm) {
		state.dom.chatForm.addEventListener("submit", handleChatSubmit);
		state.flags.chatFormBound = true;
	}

	if (state.dom.newChatButton) {
		state.dom.newChatButton.addEventListener("click", () => {
			createNewChat();
			resetChatInput();
			closeSidebarOnMobile();
		});
	}

	if (!state.flags.sidebarToggleBound && state.dom.sidebarToggle) {
		state.dom.sidebarToggle.addEventListener("click", () => toggleSidebar());
		state.flags.sidebarToggleBound = true;
	}
}

function handleChatSubmit(event) {
	event.preventDefault();
	const input = state.dom.chatInput;
	if (!input) return;
	const text = input.value.trim();
	if (!text) return;
	sendMessage(text);
}

function getCurrentChat() {
	return state.chats.find((chat) => chat.id === state.currentChatId) || null;
}

function sendMessage(text) {
	const chat = getCurrentChat() || createNewChat();
	const timestamp = new Date().toISOString();
	const message = {
		id: uniqueId("msg_"),
		chatId: chat.id,
		role: "user",
		type: "text",
		content: text,
		createdAt: timestamp
	};
	state.messages.push(message);
	chat.updatedAt = timestamp;
	if (!chat.title || chat.title.toLowerCase() === "new conversation") {
		chat.title = text.slice(0, 60) + (text.length > 60 ? "…" : "");
	}
	persistChats();
	persistMessages();
	resetChatInput();
	renderSidebar();
	renderChat();
	handleAssistantResponse(text, chat.id);
}

function handleAssistantResponse(userText, chatId) {
	const normalized = (userText || "").toLowerCase();
	const chat = state.chats.find((item) => item.id === chatId);
	if (!chat) return;

	if (isComplianceAnalysisIntent(normalized)) {
		const timestamp = new Date().toISOString();
		const guidance = {
			id: uniqueId("msg_"),
			chatId,
			role: "assistant",
			type: "text",
			content: "Great, let's start a new compliance analysis. First, upload or paste the new requirement below.",
			createdAt: timestamp
		};
		const workflow = {
			id: uniqueId("wf_"),
			chatId,
			role: "assistant",
			type: "upload-form",
			content: "Upload or paste the requirement so I can review it.",
			createdAt: timestamp
		};
		state.messages.push(guidance, workflow);
		chat.updatedAt = timestamp;
		persistChats();
		persistMessages();
		if (state.currentChatId === chatId) {
			renderSidebar();
			renderChat();
		}
		return;
	}

	const replyText = generateAssistantReply(userText);
	setTimeout(() => {
		const activeChat = state.chats.find((item) => item.id === chatId);
		if (!activeChat) return;
		const timestamp = new Date().toISOString();
		const response = {
			id: uniqueId("msg_"),
			chatId,
			role: "assistant",
			type: "text",
			content: replyText,
			createdAt: timestamp
		};
		state.messages.push(response);
		activeChat.updatedAt = timestamp;
		persistChats();
		persistMessages();
		if (state.currentChatId === chatId) {
			renderSidebar();
			renderChat();
		}
	}, 650);
}

function renderSidebar() {
	renderChatList();
	renderPromptLibrary();
}

function renderChatList() {
	const container = state.dom.chatList;
	if (!container) return;
	container.innerHTML = "";

	if (!state.chats.length) {
		container.innerHTML = "<p class=\"list-item\">No conversations yet.</p>";
		return;
	}

	const chats = [...state.chats].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
	chats.forEach((chat) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "list-item";
		if (chat.id === state.currentChatId) {
			button.classList.add("is-active");
		}
		button.textContent = chat.title || "Untitled chat";
		button.addEventListener("click", () => {
			state.currentChatId = chat.id;
			renderSidebar();
			renderChat();
			closeSidebarOnMobile();
		});
		container.appendChild(button);
	});
}

function renderPromptLibrary() {
	const container = state.dom.promptLibrary;
	if (!container) return;
	container.innerHTML = "";
	state.prompts.forEach((prompt) => {
		const chip = document.createElement("button");
		chip.type = "button";
		chip.className = "chip";
		chip.textContent = prompt.label;
		chip.addEventListener("click", () => handlePromptSelection(prompt.label));
		container.appendChild(chip);
	});
}

function handlePromptSelection(text) {
	if (!text || !state.dom.chatInput) return;
	state.dom.chatInput.value = text;
	sendMessage(text);
}

function renderChat() {
	renderChatTitle();
	renderChatMessages();
	renderChatSuggestions();
}

function renderWorkspaceForActiveArtifact() {
	const panel = state.dom.workspacePanel;
	if (!panel) return;
	const layout = state.dom.assistantLayout;
	const artifact = activeArtifactId ? getArtifactById(activeArtifactId) : null;
	if (!artifact) {
		panel.innerHTML = "";
		panel.classList.remove("is-active");
		panel.classList.add("is-hidden");
		panel.setAttribute("aria-hidden", "true");
		if (layout) {
			layout.classList.add("workspace-collapsed");
			layout.classList.remove("workspace-expanded");
		}
		return;
	}
	panel.classList.remove("is-hidden");
	panel.classList.add("is-active");
	panel.removeAttribute("aria-hidden");
	if (layout) {
		layout.classList.remove("workspace-collapsed");
		layout.classList.add("workspace-expanded");
	}
	const renderer = WORKSPACE_RENDERERS[artifact.type] || renderGenericWorkspace;
	panel.innerHTML = renderer(artifact);
	bindWorkspaceInteractions(artifact);
}

function renderChatTitle() {
	const chat = getCurrentChat();
	if (state.dom.chatTitle) {
		state.dom.chatTitle.textContent = chat?.title || "New conversation";
	}
}

function renderChatMessages() {
	const container = state.dom.chatMessages;
	if (!container) return;
	container.innerHTML = "";
	const chat = getCurrentChat();
	if (!chat) {
		return;
	}
	const messages = getMessagesForChat(chat.id);
	if (!messages.length) {
		const empty = document.createElement("div");
		empty.className = "chat-empty";
		empty.textContent = "No messages yet. Ask a policy question to get started.";
		container.appendChild(empty);
		return;
	}
	messages.forEach((message) => {
		const bubble = document.createElement("article");
		bubble.className = `chat-message chat-message--${message.role} chat-message-type-${message.type || "text"}`;
		const headerHtml = `
			<header>
				<strong>${message.role === "user" ? "You" : "Assistant"}</strong>
				<span>${new Date(message.createdAt).toLocaleString()}</span>
			</header>
		`;
		const bodyHtml = buildMessageBodyHtml(message);
		bubble.innerHTML = headerHtml + bodyHtml;
		if (message.type === "upload-form") {
			const form = bubble.querySelector(".workflow-form");
			if (form) {
				form.addEventListener("submit", (event) => {
					event.preventDefault();
					const formData = new FormData(form);
					const payload = Object.fromEntries(formData.entries());
					startRequirementAnalysis(payload, message.chatId);
				});
			}
		}
		if (message.type === "recommendations") {
			attachRecommendationInteractions(bubble, message);
		}
		if (message.type === "tasks") {
			attachTaskInteractions(bubble, message);
		}
		if (message.type === "artifact-link") {
			attachArtifactLinkInteractions(bubble, message);
		}
		container.appendChild(bubble);
	});
	requestAnimationFrame(() => {
		const top = container.scrollHeight;
		if (typeof container.scrollTo === "function") {
			container.scrollTo({ top, behavior: "smooth" });
		} else {
			container.scrollTop = top;
		}
	});
}

function buildMessageBodyHtml(message) {
	const type = MESSAGE_TYPES.includes(message.type) ? message.type : "text";
	switch (type) {
		case "upload-form":
			return buildUploadFormHtml(message);
		case "recommendations":
			return buildRecommendationsHtml(message);
		case "tasks":
			return buildTasksHtml(message);
		case "summary":
			return buildSummaryHtml(message);
		case "artifact-link":
			return buildArtifactLinkHtml(message);
		case "text":
		default:
			return `<p>${escapeHtml(message.content)}</p>`;
	}
}

function buildUploadFormHtml(message) {
	const requirement = message.meta?.requirement || {};
	const titleValue = requirement.title || "";
	const dateValue = requirement.effectiveDate || "";
	const urlValue = requirement.sourceUrl || "";
	const detailValue = requirement.detail || "";
	return `
		<div class="workflow-card">
			<header>
				<h3>Upload or paste requirement</h3>
				<p>${escapeHtml(message.content || "Provide more context about the new requirement.")}</p>
			</header>
			<form class="workflow-form" data-chat-id="${message.chatId}" data-message-id="${message.id}">
				<label>
					<span>Requirement title</span>
					<input type="text" name="title" value="${escapeAttribute(titleValue)}" placeholder="e.g., SB-104 Digital Accessibility" required />
				</label>
				<label>
					<span>Effective date</span>
					<input type="date" name="effectiveDate" value="${escapeAttribute(dateValue)}" />
				</label>
				<label>
					<span>Source URL</span>
					<input type="url" name="sourceUrl" value="${escapeAttribute(urlValue)}" placeholder="https://" />
				</label>
				<label>
					<span>Paste requirement text</span>
					<textarea name="detail" rows="5" placeholder="Paste the policy or regulation text here">${escapeHtml(detailValue)}</textarea>
				</label>
				<button type="submit" class="btn btn-primary">Analyze with AI</button>
			</form>
		</div>
	`;
}

function buildRecommendationsHtml(message) {
	const recommendations = message.meta?.recommendations || [];
	if (!recommendations.length) {
		return "<p>No recommendations yet. Try re-running the analysis.</p>";
	}
	const cards = recommendations
		.map((rec) => {
			const source = rec.source || {};
			return `
				<article class="recommendation-card" data-rec-id="${rec.id}">
					<header>
						<label class="recommendation-select">
							<input type="checkbox" value="${rec.id}" data-role="recommendation-select" />
							<span>Select</span>
						</label>
						<div class="recommendation-tags">
							<span class="recommendation-tag">${escapeHtml(rec.category || "")}</span>
							<span class="recommendation-tag">Risk: ${escapeHtml(rec.risk || "")}</span>
							<span class="recommendation-tag">Effort: ${escapeHtml(rec.effort || "")}</span>
						</div>
					</header>
					<p class="recommendation-description">${escapeHtml(rec.description || "")}</p>
					<div class="recommendation-source">
						<span class="badge">${escapeHtml(source.title || "Source")} · ${escapeHtml(source.section || "")}</span>
						<p>${escapeHtml(source.excerpt || "")}</p>
						${source.url ? `<a href="${escapeAttribute(source.url)}" target="_blank" rel="noopener noreferrer">View source</a>` : ""}
					</div>
				</article>
			`;
		})
		.join("");
	return `
		<div class="recommendations-group" data-message-id="${message.id}">
			${cards}
			<div class="recommendations-actions">
				<button type="button" class="btn btn-primary" data-role="recommendations-continue">
					Continue: Review selected tasks
				</button>
			</div>
		</div>
	`;
}

function buildTasksHtml(message) {
	const meta = message.meta || {};
	const tasks = Array.isArray(meta.tasks) ? meta.tasks : [];
	if (!tasks.length) {
		return "<p>No tasks available yet.</p>";
	}
	const mode = meta.mode || "review";
	switch (mode) {
		case "priority":
			return buildTaskPriorityHtml(message, tasks);
		case "assignment":
			return buildTaskAssignmentHtml(message, tasks);
		case "review":
		default:
			return buildTaskReviewHtml(message, tasks);
	}
}

function buildTaskReviewHtml(message, tasks) {
	const cards = tasks
		.map((task) => {
			return `
				<article class="task-card" data-task-id="${task.id}" data-status="${task.status || "pending"}">
					<header>
						<span class="task-category">${escapeHtml(task.category || "Task")}</span>
						<span class="task-status" data-role="task-status">${(task.status || "pending").toUpperCase()}</span>
					</header>
					<label>
						<span>Title</span>
						<input type="text" name="title" value="${escapeAttribute(task.title || "")}" />
					</label>
					<label>
						<span>Description</span>
						<textarea name="description" rows="3">${escapeHtml(task.description || "")}</textarea>
					</label>
					<label>
						<span>Risk</span>
						<select name="risk">
							${["High", "Medium", "Low"]
								.map((option) => `<option value="${option}" ${option === (task.risk || "Medium") ? "selected" : ""}>${option}</option>`)
								.join("")}
						</select>
					</label>
					<div class="task-actions">
						<button type="button" class="btn btn-primary" data-action="accept">Accept</button>
						<button type="button" class="btn btn-ghost" data-action="snooze">Snooze</button>
						<button type="button" class="btn btn-ghost" data-action="reject">Reject</button>
					</div>
					${task.source ? buildTaskSourceHtml(task.source) : ""}
				</article>
			`;
		})
		.join("");
	return `
		<div class="tasks-group" data-message-id="${message.id}" data-mode="review">
			${cards}
			<div class="tasks-actions">
				<button type="button" class="btn btn-primary" data-role="tasks-next">
					Next: Prioritize accepted tasks
				</button>
			</div>
		</div>
	`;
}

function buildTaskPriorityHtml(message, tasks) {
	const priorities = ["HIGH", "MEDIUM", "LOW"];
	const sections = priorities
		.map((level) => {
			const group = tasks.filter((task) => (task.priority || "LOW").toUpperCase() === level);
			if (!group.length) return "";
			const cards = group
				.map((task) => {
					return `
						<article class="task-card" data-task-id="${task.id}" data-status="${task.status || "accepted"}">
							<header>
								<span class="task-category">${escapeHtml(task.category || "Task")}</span>
								<span class="task-priority">${level}</span>
							</header>
							<p class="task-title">${escapeHtml(task.title || "Untitled task")}</p>
							<p class="task-description">${escapeHtml(task.description || "")}</p>
							${task.source ? buildTaskSourceHtml(task.source) : ""}
						</article>
					`;
				})
				.join("");
			return `
				<section class="task-priority-group">
					<h4>${level} priority</h4>
					${cards}
				</section>
			`;
		})
		.join("");
	return `
		<div class="tasks-group" data-message-id="${message.id}" data-mode="priority">
			${sections}
			<div class="tasks-actions">
				<button type="button" class="btn btn-primary" data-role="tasks-assign">
					Next: Assign tasks
				</button>
			</div>
		</div>
	`;
}

function buildTaskAssignmentHtml(message, tasks) {
	const cards = tasks
		.map((task) => `
			<article class="task-card" data-task-id="${task.id}">
				<header>
					<span class="task-category">${escapeHtml(task.category || "Task")}</span>
					<span class="task-priority">${(task.priority || "MEDIUM").toUpperCase()}</span>
				</header>
				<p class="task-title">${escapeHtml(task.title || "Untitled task")}</p>
				<label>
					<span>Assign to</span>
					<select name="assignee">
						${["HR", "Legal", "IT", "Training", "Operations"]
							.map((team) => `<option value="${team}" ${team === (task.assignee || "") ? "selected" : ""}>${team}</option>`)
							.join("")}
					</select>
				</label>
				<label>
					<span>Due date</span>
					<input type="date" name="dueDate" value="${escapeAttribute(task.dueDate || "")}" />
				</label>
			</article>
		`)
		.join("");
	return `
		<div class="tasks-group" data-message-id="${message.id}" data-mode="assignment">
			${cards}
			<div class="tasks-actions">
				<button type="button" class="btn btn-primary" data-role="tasks-finalize">
					Create tasks & generate summary
				</button>
			</div>
		</div>
	`;
}

function buildTaskSourceHtml(source = {}) {
	return `
		<div class="task-source">
			<span class="badge">${escapeHtml(source.title || "Source")} · ${escapeHtml(source.section || "")}</span>
			<p>${escapeHtml(source.excerpt || "")}</p>
			${source.url ? `<a href="${escapeAttribute(source.url)}" target="_blank" rel="noopener noreferrer">View source</a>` : ""}
		</div>
	`;
}

function buildSummaryHtml(message) {
	const tasks = Array.isArray(message.meta?.tasks) ? message.meta.tasks : [];
	const counts = tasks.reduce(
		(acc, task) => {
			const key = (task.priority || "LOW").toUpperCase();
			acc[key] = (acc[key] || 0) + 1;
			return acc;
		},
		{ HIGH: 0, MEDIUM: 0, LOW: 0 }
	);
	const listItems = tasks
		.map((task) => {
			const assignee = task.assignee || "Unassigned";
			const due = task.dueDate ? ` · Due ${escapeHtml(task.dueDate)}` : "";
			return `<li><strong>${escapeHtml(task.title || "Task")}</strong> (${(task.priority || "LOW").toUpperCase()} · ${escapeHtml(assignee)}${due})</li>`;
		})
		.join("");
	return `
		<div class="summary-card">
			<p>${escapeHtml(message.content || "")}</p>
			<div class="summary-stats">
				<div><span>High</span><strong>${counts.HIGH || 0}</strong></div>
				<div><span>Medium</span><strong>${counts.MEDIUM || 0}</strong></div>
				<div><span>Low</span><strong>${counts.LOW || 0}</strong></div>
			</div>
			${listItems ? `<div class="summary-tasks"><h4>Assignments</h4><ul>${listItems}</ul></div>` : ""}
		</div>
	`;
}

function buildArtifactLinkHtml(message) {
	const artifact = message.artifactId ? getArtifactById(message.artifactId) : null;
	const title = escapeHtml(artifact?.title || message.content || "Workspace artifact");
	const summary = escapeHtml(artifact?.summary || "Open the workspace to review details.");
	const timestampValue = artifact?.updatedAt || artifact?.createdAt || (message.createdAt ? new Date(message.createdAt).getTime() : Date.now());
	const timestamp = new Date(timestampValue).toLocaleString();
	const disabledAttr = message.artifactId ? "" : "disabled";
	return `
		<div class="artifact-link-card" data-artifact-id="${escapeAttribute(message.artifactId || "")}">
			<div class="artifact-link-text">
				<p class="artifact-link-title">${title}</p>
				<p class="artifact-link-summary">${summary}</p>
				<span class="artifact-link-timestamp">${escapeHtml(timestamp)}</span>
			</div>
			<button type="button" class="btn btn-primary btn-sm" data-role="artifact-open" ${disabledAttr}>Open workspace</button>
		</div>
	`;
}

function renderChatSuggestions() {
	const container = state.dom.chatSuggestions;
	if (!container) return;
	container.innerHTML = "";
	const chat = getCurrentChat();
	if (!chat) {
		container.style.display = "none";
		return;
	}
	const messages = getMessagesForChat(chat.id);
	const hasOnlyGreeting = messages.length === 1 && messages[0]?.role === "assistant";
	if (!hasOnlyGreeting) {
		container.style.display = "none";
		return;
	}
	container.style.display = "flex";
	PROMPT_LIBRARY.slice(0, 3).forEach((prompt) => {
		const chip = document.createElement("button");
		chip.type = "button";
		chip.className = "suggestion-card";
		chip.innerHTML = `
			<strong>${prompt.label}</strong>
		`;
		chip.addEventListener("click", () => handlePromptSelection(prompt.label));
		container.appendChild(chip);
	});
}

const WORKSPACE_RENDERERS = {
	recommendations: renderRecommendationsWorkspace,
	tasks: renderTasksWorkspace,
	prioritization: renderPrioritizationWorkspace,
	assignments: renderAssignmentsWorkspace,
	summary: renderSummaryWorkspace
};

function bindWorkspaceInteractions(artifact) {
	if (!artifact) return;
	switch (artifact.type) {
		case "recommendations":
			bindRecommendationsWorkspaceEvents(artifact);
			break;
		case "tasks":
			bindTasksWorkspaceEvents(artifact);
			break;
		case "prioritization":
			bindPrioritizationWorkspaceEvents(artifact);
			break;
		case "assignments":
			bindAssignmentsWorkspaceEvents(artifact);
			break;
		case "summary":
			bindSummaryWorkspaceEvents(artifact);
			break;
		default:
			break;
	}
}

function buildWorkspaceEmptyState() {
	return `<div class="workspace-empty" role="status">No workspace open yet</div>`;
}

function renderGenericWorkspace(artifact) {
	return buildWorkspacePanel("Artifact", artifact);
}

function buildWorkspaceHeader(artifact, label, fallbackDescription = "", options = {}) {
	const title = escapeHtml(artifact.title || label || "Workspace");
	const description = artifact.summary || fallbackDescription || "";
	const roleAttr = options.descriptionRole ? ` data-role="${escapeAttribute(options.descriptionRole)}"` : "";
	const descriptionHtml = description ? `<p class="workspace-description"${roleAttr}>${escapeHtml(description)}</p>` : "";
	return `
		<header class="workspace-card-header">
			<div class="workspace-header-text">
				<p class="workspace-eyebrow">${escapeHtml(`${label} workspace`)}</p>
				<h3>${title}</h3>
				${descriptionHtml}
			</div>
			<div class="workspace-header-actions">
				<button type="button" class="btn btn-ghost btn-sm" data-role="workspace-save-close">Save & close</button>
			</div>
		</header>
	`;
}

function handleWorkspaceSaveAndClose(artifactId) {
	const artifact = getArtifactById(artifactId);
	if (!artifact) return;
	const summaryText = buildArtifactSummaryText(artifact) || artifact.summary || "Workspace saved.";
	updateArtifact(artifactId, () => ({ summary: summaryText }));
	activeArtifactId = null;
	renderWorkspaceForActiveArtifact();
}

function attachWorkspaceSaveClose(container, artifact) {
	const saveCloseButton = container.querySelector('[data-role="workspace-save-close"]');
	if (!saveCloseButton) return;
	saveCloseButton.addEventListener("click", () => handleWorkspaceSaveAndClose(artifact.id));
}

function renderRecommendationsWorkspace(artifact) {
	const recommendations = Array.isArray(artifact?.data?.recommendations) ? artifact.data.recommendations : [];
	if (!recommendations.length) {
		return buildWorkspacePanel("Recommendations", artifact);
	}
	const selectedSet = new Set(Array.isArray(artifact?.data?.selectedRecommendationIds) ? artifact.data.selectedRecommendationIds : []);
	const summaryText = buildArtifactSummaryText(artifact) || "Select recommendations to convert into tasks.";
	const header = buildWorkspaceHeader(artifact, "Recommendations", summaryText);
	const cards = recommendations
		.map((rec) => {
			const checked = selectedSet.has(rec.id) ? "checked" : "";
			return `
				<article class="workspace-rec-card">
					<label class="workspace-rec-select">
						<input type="checkbox" value="${escapeAttribute(rec.id)}" data-role="workspace-rec-select" ${checked} />
						<span>Select</span>
					</label>
					<div>
						<h4>${escapeHtml(rec.description?.split(".").at(0) || "Recommendation")}</h4>
						<p>${escapeHtml(rec.description || "")}</p>
						<div class="workspace-rec-meta">
							<span>Category: ${escapeHtml(rec.category || "n/a")}</span>
							<span>Risk: ${escapeHtml(rec.risk || "n/a")}</span>
							<span>Effort: ${escapeHtml(rec.effort || "n/a")}</span>
						</div>
					</div>
				</article>
			`;
		})
		.join("");
	return `
		<section class="workspace-card workspace-recommendations" data-artifact-id="${escapeAttribute(artifact.id)}">
			${header}
			<p class="workspace-helper-text">Choose the recommendations you want to convert into actionable tasks.</p>
			<div class="workspace-recommendations-list">
				${cards}
			</div>
			<footer class="workspace-actions">
				<button type="button" class="btn btn-ghost" data-role="workspace-save">Save selections</button>
				<button type="button" class="btn btn-primary" data-role="workspace-continue">Generate tasks from selected</button>
			</footer>
		</section>
	`;
}

function renderTasksWorkspace(artifact) {
	const tasks = Array.isArray(artifact?.data?.tasks) ? artifact.data.tasks : [];
	if (!tasks.length) {
		return buildWorkspacePanel("Tasks", artifact);
	}
	const summaryText = buildArtifactSummaryText(artifact) || "Accept the tasks you want to move forward before prioritizing.";
	const header = buildWorkspaceHeader(artifact, "Tasks", summaryText);
	const cards = tasks
		.map((task) => {
			const status = task.status || "pending";
			return `
				<article class="workspace-task-card ${status ? `is-${status}` : ""}" data-task-id="${escapeAttribute(task.id)}" data-status="${escapeAttribute(status)}">
					<header>
						<span class="task-category">${escapeHtml(task.category || "Task")}</span>
						<span class="task-status" data-role="task-status">${status.toUpperCase()}</span>
					</header>
					<label>
						<span>Title</span>
						<input type="text" value="${escapeAttribute(task.title || "")}" disabled />
					</label>
					<label>
						<span>Description</span>
						<textarea rows="3" disabled>${escapeHtml(task.description || "")}</textarea>
					</label>
					<label>
						<span>Risk</span>
						<input type="text" value="${escapeAttribute(task.risk || "Medium")}" disabled />
					</label>
					<div class="workspace-task-actions">
						<button type="button" class="btn btn-primary btn-sm" data-action="accept">Accept</button>
						<button type="button" class="btn btn-ghost btn-sm" data-action="snooze">Snooze</button>
						<button type="button" class="btn btn-ghost btn-sm" data-action="reject">Reject</button>
					</div>
					${task.source ? buildTaskSourceHtml(task.source) : ""}
				</article>
			`;
		})
		.join("");
	return `
		<section class="workspace-card workspace-tasks" data-artifact-id="${escapeAttribute(artifact.id)}">
			${header}
			<p class="workspace-helper-text">Accept or snooze tasks to control what moves into prioritization.</p>
			<div class="workspace-tasks-list">
				${cards}
			</div>
			<footer class="workspace-actions">
				<button type="button" class="btn btn-primary" data-role="workspace-tasks-next">Next: Prioritize accepted tasks</button>
			</footer>
		</section>
	`;
}

function renderPrioritizationWorkspace(artifact) {
	const tasks = Array.isArray(artifact?.data?.tasks) ? artifact.data.tasks : [];
	if (!tasks.length) {
		return buildWorkspacePanel("Prioritization", artifact);
	}
	const summaryText = buildArtifactSummaryText(artifact) || buildPrioritizationSummary(tasks);
	const header = buildWorkspaceHeader(artifact, "Prioritization", summaryText, { descriptionRole: "priority-summary" });
	const sorted = [...tasks].sort((a, b) => {
		const orderA = typeof a.order === "number" ? a.order : getPriorityRank(a.priority || a.risk);
		const orderB = typeof b.order === "number" ? b.order : getPriorityRank(b.priority || b.risk);
		return orderA - orderB;
	});
	const cards = sorted
		.map((task, index) => {
			const priority = (task.priority || derivePriorityFromRisk(task.risk || "")).toUpperCase();
			const order = typeof task.order === "number" ? task.order : index;
			const risk = (task.risk || "Medium").toUpperCase();
			return `
				<li class="workspace-priority-item" draggable="true" data-task-id="${escapeAttribute(task.id)}" data-order="${escapeAttribute(String(order))}" data-priority="${escapeAttribute(priority)}">
					<div class="workspace-priority-handle" aria-hidden="true">⋮⋮</div>
					<div class="workspace-priority-body">
						<p class="workspace-priority-title">${escapeHtml(task.title || "Untitled task")}</p>
						<p class="workspace-priority-meta">Risk ${escapeHtml(risk)} · ${escapeHtml(task.category || "Task")}</p>
					</div>
					<div class="workspace-priority-controls">
						<span class="workspace-priority-pill" data-role="priority-label">${priority}</span>
						<label>
							<span>Priority</span>
							<select data-role="priority-select">
								${PRIORITY_LEVELS.map((level) => `<option value="${level}" ${level === priority ? "selected" : ""}>${level}</option>`).join("")}
							</select>
						</label>
					</div>
				</li>
			`;
		})
		.join("");
	return `
		<section class="workspace-card workspace-prioritization" data-artifact-id="${escapeAttribute(artifact.id)}">
			${header}
			<p class="workspace-helper-text">Drag tasks to reorder them or adjust each priority level before assignment.</p>
			<div class="workspace-priority-board">
				<ul class="workspace-priority-list" aria-live="polite">
					${cards}
				</ul>
			</div>
			<footer class="workspace-actions">
				<button type="button" class="btn btn-primary" data-role="workspace-priority-next">Next: Assign tasks</button>
			</footer>
		</section>
	`;
}

function renderAssignmentsWorkspace(artifact) {
	const tasks = Array.isArray(artifact?.data?.tasks) ? artifact.data.tasks : [];
	if (!tasks.length) {
		return buildWorkspacePanel("Assignments", artifact);
	}
	const sorted = [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	const summaryText = buildArtifactSummaryText(artifact) || buildAssignmentSummary(tasks);
	const header = buildWorkspaceHeader(artifact, "Assignments", summaryText, { descriptionRole: "assignment-summary" });
	const cards = sorted
		.map((task) => {
			const priority = (task.priority || derivePriorityFromRisk(task.risk || "")).toUpperCase();
			return `
				<article class="workspace-assignment-card" data-task-id="${escapeAttribute(task.id)}">
					<header>
						<div>
							<p class="workspace-assignment-title">${escapeHtml(task.title || "Untitled task")}</p>
							<p class="workspace-assignment-meta">${escapeHtml(task.category || "Task")} · Risk ${escapeHtml((task.risk || "Medium").toUpperCase())}</p>
						</div>
						<span class="workspace-priority-pill">${priority}</span>
					</header>
					<p class="workspace-assignment-description">${escapeHtml(task.description || "")}</p>
					<div class="workspace-assignment-fields">
						<label>
							<span>Assign to</span>
							<select data-role="assignment-select">
								<option value="">Select owner</option>
								${ASSIGNEE_OPTIONS.map((team) => `<option value="${escapeAttribute(team)}" ${team === (task.assignee || "") ? "selected" : ""}>${escapeHtml(team)}</option>`).join("")}
							</select>
						</label>
						<label>
							<span>Due date</span>
							<input type="date" value="${escapeAttribute(task.dueDate || "")}" data-role="assignment-due" />
						</label>
					</div>
					${task.source ? buildTaskSourceHtml(task.source) : ""}
				</article>
			`;
		})
		.join("");
	return `
		<section class="workspace-card workspace-assignments" data-artifact-id="${escapeAttribute(artifact.id)}">
			${header}
			<p class="workspace-helper-text">Assign owners and due dates before creating the final workflow summary.</p>
			<div class="workspace-assignments-list">
				${cards}
			</div>
			<footer class="workspace-actions">
				<button type="button" class="btn btn-primary" data-role="workspace-assignments-complete">Create tasks & start workflow</button>
			</footer>
		</section>
	`;
}

function renderSummaryWorkspace(artifact) {
	const tasks = Array.isArray(artifact?.data?.tasks) ? artifact.data.tasks : [];
	if (!tasks.length) {
		return buildWorkspacePanel("Summary", artifact);
	}
	const counts = summarizePriorityCounts(tasks);
	const summary = `${tasks.length} task(s) - ${counts.HIGH} high / ${counts.MEDIUM} medium / ${counts.LOW} low`;
	const summaryText = buildArtifactSummaryText(artifact) || summary;
	const header = buildWorkspaceHeader(artifact, "Summary", summaryText);
	const owners = Array.isArray(artifact?.data?.owners) ? artifact.data.owners : [];
	const ownersHtml = owners.length
		? owners.map((owner) => `<span class="workspace-summary-owner">${escapeHtml(owner)}</span>`).join("")
		: '<span class="workspace-summary-owner is-empty">Unassigned</span>';
	const assignments = tasks
		.map((task) => {
			const assignee = task.assignee || "Unassigned";
			const due = task.dueDate ? ` · Due ${escapeHtml(task.dueDate)}` : "";
			return `<li><strong>${escapeHtml(task.title || "Task")}</strong> (${escapeHtml(assignee)}${due})</li>`;
		})
		.join("") || "<li>No assignments captured yet.</li>";
	return `
		<section class="workspace-card workspace-summary" data-artifact-id="${escapeAttribute(artifact.id)}">
			${header}
			<p class="workspace-helper-text">Review the final assignments and owners captured for this workflow.</p>
			<div class="workspace-summary-grid">
				<div class="workspace-summary-stat">
					<span>High</span>
					<strong>${counts.HIGH}</strong>
				</div>
				<div class="workspace-summary-stat">
					<span>Medium</span>
					<strong>${counts.MEDIUM}</strong>
				</div>
				<div class="workspace-summary-stat">
					<span>Low</span>
					<strong>${counts.LOW}</strong>
				</div>
			</div>
			<div class="workspace-summary-list">
				<h4>Assignments</h4>
				<ul>
					${assignments}
				</ul>
			</div>
			<div class="workspace-summary-owners">
				<h4>Owners</h4>
				<div class="workspace-summary-owner-list">
					${ownersHtml}
				</div>
			</div>
		</section>
	`;
}

function buildWorkspacePanel(label, artifact) {
	const title = escapeHtml(artifact.title || label);
	const summary = escapeHtml(artifact.summary || "No summary available yet.");
	const rawPreview = artifact.data ? JSON.stringify(artifact.data, null, 2) : "No structured data captured yet.";
	const dataPreview = escapeHtml(rawPreview);
	return `
		<section class="workspace-card">
			<header>
				<p class="workspace-eyebrow">${escapeHtml(label)}</p>
				<h3>${title}</h3>
				<p>${summary}</p>
			</header>
			<pre class="workspace-data">${dataPreview}</pre>
		</section>
	`;
}

function bindRecommendationsWorkspaceEvents(artifact) {
	const panel = state.dom.workspacePanel;
	if (!panel) return;
	const container = panel.querySelector(".workspace-recommendations");
	if (!container) return;
	attachWorkspaceSaveClose(container, artifact);
	const continueButton = container.querySelector('[data-role="workspace-continue"]');
	const saveButton = container.querySelector('[data-role="workspace-save"]');
	const checkboxSelector = '[data-role="workspace-rec-select"]';
	const getSelectedIds = () =>
		Array.from(container.querySelectorAll(checkboxSelector))
			.filter((input) => input.checked)
			.map((input) => input.value);
	if (continueButton) {
		continueButton.addEventListener("click", () => {
			const selectedIds = getSelectedIds();
			handleRecommendationsContinue(artifact, selectedIds);
		});
	}
	if (saveButton) {
		saveButton.addEventListener("click", () => {
			const selectedIds = getSelectedIds();
			handleRecommendationsSave(artifact, selectedIds);
		});
	}
}

function handleRecommendationsSave(artifact, selectedIds = []) {
	const total = Array.isArray(artifact?.data?.recommendations) ? artifact.data.recommendations.length : 0;
	updateArtifact(artifact.id, () => ({
		summary: `${total} recommendations · ${selectedIds.length} selected`,
		data: {
			...artifact.data,
			selectedRecommendationIds: selectedIds
		}
	}));
	setActiveArtifact(null);
	renderWorkspaceForActiveArtifact();
}

function handleRecommendationsContinue(artifact, selectedIds = []) {
	const recommendations = Array.isArray(artifact?.data?.recommendations) ? artifact.data.recommendations : [];
	if (!selectedIds.length) {
		appendAssistantNotice(state.currentChatId, "Select at least one recommendation before continuing.");
		return;
	}
	const selected = recommendations.filter((rec) => selectedIds.includes(rec.id));
	const tasks = buildTasksFromRecommendations(selected);
	updateArtifact(artifact.id, () => ({
		summary: `${recommendations.length} recommendations · ${selectedIds.length} selected`,
		data: {
			...artifact.data,
			selectedRecommendationIds: selectedIds,
			tasks
		}
	}));
	const requirementTitle = artifact?.data?.requirementMeta?.title || "the requirement";
	const tasksArtifactId = createArtifact({
		type: "tasks",
		title: `Tasks from ${requirementTitle}`,
		summary: `${tasks.length} tasks created`,
		data: {
			tasks,
			sourceArtifactId: artifact.id,
			requirementTitle
		}
	});
	appendAssistantTaskTransitionMessage(tasks.length, requirementTitle, tasksArtifactId);
	setActiveArtifact(tasksArtifactId);
	renderWorkspaceForActiveArtifact();
}

function handleTasksWorkspaceContinue(artifact) {
	const tasks = Array.isArray(artifact?.data?.tasks) ? artifact.data.tasks : [];
	const accepted = tasks.filter((task) => task.status === "accepted");
	if (!accepted.length) {
		appendAssistantNotice(state.currentChatId, "Accept at least one task before prioritizing.");
		return;
	}
	const normalizedAccepted = accepted.map((task, index) => ({
		...task,
		priority: (task.priority || derivePriorityFromRisk(task.risk || "")).toUpperCase(),
		order: typeof task.order === "number" ? task.order : index
	}));
	updateArtifact(artifact.id, () => ({
		summary: `${tasks.length} tasks · ${accepted.length} accepted`,
		data: {
			...artifact.data,
			tasks,
			acceptedTasks: normalizedAccepted
		}
	}));
	const requirementTitle = artifact?.data?.requirementTitle || "this requirement";
	const priorityCounts = summarizeRiskCounts(normalizedAccepted);
	const prioritizationArtifactId = createArtifact({
		type: "prioritization",
		title: `Prioritize tasks for ${requirementTitle}`,
		summary: `${normalizedAccepted.length} tasks · ${priorityCounts.HIGH} high risk`,
		data: {
			tasks: normalizedAccepted,
			sourceArtifactId: artifact.id,
			requirementTitle
		}
	});
	appendAssistantPrioritizationMessage(normalizedAccepted.length, requirementTitle, prioritizationArtifactId);
	setActiveArtifact(prioritizationArtifactId);
	renderWorkspaceForActiveArtifact();
}

function handlePrioritizationWorkspaceContinue(artifact) {
	const tasks = Array.isArray(artifact?.data?.tasks) ? artifact.data.tasks : [];
	if (!tasks.length) {
		appendAssistantNotice(state.currentChatId, "No tasks available to assign.");
		return;
	}
	const prioritized = [...tasks]
		.map((task, index) => ({
			...task,
			priority: (task.priority || derivePriorityFromRisk(task.risk || "")).toUpperCase(),
			order: typeof task.order === "number" ? task.order : index
		}))
		.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
	const summary = buildPrioritizationSummary(prioritized);
	updateArtifact(artifact.id, () => ({
		summary,
		data: {
			...artifact.data,
			tasks: prioritized
		}
	}));
	const requirementTitle = artifact?.data?.requirementTitle || "this requirement";
	const assignmentsArtifactId = createArtifact({
		type: "assignments",
		title: `Assign owners for ${requirementTitle}`,
		summary: `${prioritized.length} prioritized task(s) ready for owners`,
		data: {
			tasks: prioritized,
			sourceArtifactId: artifact.id,
			requirementTitle
		}
	});
	appendAssistantAssignmentMessage(prioritized.length, requirementTitle, assignmentsArtifactId);
	setActiveArtifact(assignmentsArtifactId);
	renderWorkspaceForActiveArtifact();
}

function handleAssignmentsWorkspaceFinalize(artifact) {
	const tasks = Array.isArray(artifact?.data?.tasks) ? artifact.data.tasks : [];
	if (!tasks.length) {
		appendAssistantNotice(state.currentChatId, "No tasks available to summarize.");
		return;
	}
	const finalized = tasks.map((task, index) => ({
		...task,
		priority: (task.priority || derivePriorityFromRisk(task.risk || "")).toUpperCase(),
		assignee: task.assignee || "Unassigned",
		dueDate: task.dueDate || "",
		order: typeof task.order === "number" ? task.order : index
	}));
	const summaryText = buildAssignmentSummary(finalized);
	updateArtifact(artifact.id, () => ({
		summary: summaryText,
		data: {
			...artifact.data,
			tasks: finalized
		}
	}));
	const requirementTitle = artifact?.data?.requirementTitle || "this requirement";
	const counts = summarizePriorityCounts(finalized);
	const owners = Array.from(new Set(finalized.map((task) => task.assignee).filter(Boolean)));
	const summaryArtifactId = createArtifact({
		type: "summary",
		title: `Workflow summary for ${requirementTitle}`,
		summary: `${finalized.length} task(s) assigned`,
		data: {
			tasks: finalized,
			counts,
			owners,
			sourceArtifactId: artifact.id,
			requirementTitle
		}
	});
	state.tasks = mergeTasks(state.tasks, finalized);
	appendAssistantSummaryMessage(finalized.length, requirementTitle, summaryArtifactId, counts, finalized, owners);
	setActiveArtifact(summaryArtifactId);
	renderWorkspaceForActiveArtifact();
}

function bindTasksWorkspaceEvents(artifact) {
	const panel = state.dom.workspacePanel;
	if (!panel) return;
	const container = panel.querySelector(".workspace-tasks");
	if (!container) return;
	attachWorkspaceSaveClose(container, artifact);
	const cards = container.querySelectorAll(".workspace-task-card");
	cards.forEach((card) => {
		const taskId = card.dataset.taskId;
		const initialStatus = card.dataset.status || "pending";
		setTaskCardState(card, initialStatus);
		card.querySelectorAll("[data-action]").forEach((button) => {
			button.addEventListener("click", () => {
				const statusMap = { accept: "accepted", reject: "rejected", snooze: "snoozed" };
				const status = statusMap[button.dataset.action] || "pending";
				updateWorkspaceTaskStatus(artifact.id, taskId, status);
				setTaskCardState(card, status);
			});
		});
	});
	const nextButton = container.querySelector('[data-role="workspace-tasks-next"]');
	if (nextButton) {
		nextButton.addEventListener("click", () => handleTasksWorkspaceContinue(artifact));
	}
}

function bindPrioritizationWorkspaceEvents(artifact) {
	const panel = state.dom.workspacePanel;
	if (!panel) return;
	const container = panel.querySelector(".workspace-prioritization");
	if (!container) return;
	attachWorkspaceSaveClose(container, artifact);
	const list = container.querySelector(".workspace-priority-list");
	const prioritySelects = container.querySelectorAll('[data-role="priority-select"]');
	const summaryEl = container.querySelector('[data-role="priority-summary"]');
	const refreshSummary = () => {
		if (!summaryEl) return;
		const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
		const items = container.querySelectorAll(".workspace-priority-item");
		items.forEach((item) => {
			const select = item.querySelector('[data-role="priority-select"]');
			const value = (select?.value || "LOW").toUpperCase();
			counts[value] = (counts[value] || 0) + 1;
		});
		summaryEl.textContent = `${items.length} task(s) · ${counts.HIGH} high / ${counts.MEDIUM} medium / ${counts.LOW} low`;
	};
	prioritySelects.forEach((select) => {
		select.addEventListener("change", (event) => {
			const card = event.currentTarget.closest(".workspace-priority-item");
			if (!card) return;
			const { taskId } = card.dataset;
			const value = event.currentTarget.value;
			updateWorkspaceTaskPriority(artifact.id, taskId, value);
			const pill = card.querySelector('[data-role="priority-label"]');
			if (pill) {
				pill.textContent = value.toUpperCase();
			}
			refreshSummary();
		});
	});
	if (list) {
		let draggingId = null;
		const commitOrder = () => {
			if (!list) return;
			const orderedIds = Array.from(list.querySelectorAll(".workspace-priority-item")).map((item) => item.dataset.taskId);
			updatePrioritizationOrder(artifact.id, orderedIds);
		};
		list.addEventListener("dragstart", (event) => {
			const source = event.target;
			if (!(source instanceof HTMLElement)) return;
			const card = source.closest(".workspace-priority-item");
			if (!card) return;
			draggingId = card.dataset.taskId;
			card.classList.add("is-dragging");
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("text/plain", draggingId);
		});
		list.addEventListener("dragover", (event) => {
			event.preventDefault();
			const afterElement = getDragAfterElement(list, event.clientY);
			const draggingEl = list.querySelector(".workspace-priority-item.is-dragging");
			if (!draggingEl) return;
			if (!afterElement) {
				list.appendChild(draggingEl);
			} else if (afterElement !== draggingEl) {
				list.insertBefore(draggingEl, afterElement);
			}
		});
		const clearDragging = () => {
			const draggingEl = list.querySelector(".workspace-priority-item.is-dragging");
			if (draggingEl) {
				draggingEl.classList.remove("is-dragging");
			}
			draggingId = null;
		};
		list.addEventListener("drop", (event) => {
			event.preventDefault();
			commitOrder();
			clearDragging();
			refreshSummary();
		});
		list.addEventListener("dragend", () => {
			commitOrder();
			clearDragging();
			refreshSummary();
		});
	}
	refreshSummary();
	const nextButton = container.querySelector('[data-role="workspace-priority-next"]');
	if (nextButton) {
		nextButton.addEventListener("click", () => handlePrioritizationWorkspaceContinue(artifact));
	}
}

function bindAssignmentsWorkspaceEvents(artifact) {
	const panel = state.dom.workspacePanel;
	if (!panel) return;
	const container = panel.querySelector(".workspace-assignments");
	if (!container) return;
	attachWorkspaceSaveClose(container, artifact);
	const summaryEl = container.querySelector('[data-role="assignment-summary"]');
	const refreshSummary = () => {
		if (!summaryEl) return;
		const cards = container.querySelectorAll(".workspace-assignment-card");
		const assigned = Array.from(cards).filter((card) => {
			const select = card.querySelector('[data-role="assignment-select"]');
			return Boolean(select?.value);
		}).length;
		summaryEl.textContent = `${cards.length} prioritized task(s) · ${assigned} assigned`;
	};
	container.querySelectorAll(".workspace-assignment-card").forEach((card) => {
		const taskId = card.dataset.taskId;
		const assigneeSelect = card.querySelector('[data-role="assignment-select"]');
		const dueInput = card.querySelector('[data-role="assignment-due"]');
		if (assigneeSelect) {
			assigneeSelect.addEventListener("change", (event) => {
				updateAssignmentTaskField(artifact.id, taskId, { assignee: event.currentTarget.value });
				refreshSummary();
			});
		}
		if (dueInput) {
			dueInput.addEventListener("change", (event) => {
				updateAssignmentTaskField(artifact.id, taskId, { dueDate: event.currentTarget.value });
			});
		}
	});
	refreshSummary();
	const completeButton = container.querySelector('[data-role="workspace-assignments-complete"]');
	if (completeButton) {
		completeButton.addEventListener("click", () => handleAssignmentsWorkspaceFinalize(artifact));
	}
}

function bindSummaryWorkspaceEvents(artifact) {
	const panel = state.dom.workspacePanel;
	if (!panel) return;
	const container = panel.querySelector(".workspace-summary");
	if (!container) return;
	attachWorkspaceSaveClose(container, artifact);
}

function resetChatInput() {
	if (state.dom.chatInput) {
		state.dom.chatInput.value = "";
		state.dom.chatInput.focus();
	}
}

function toggleSidebar(force) {
	const sidebar = state.dom.sidebar;
	if (!sidebar) return;
	const isOpen = sidebar.classList.contains("is-open");
	const shouldOpen = typeof force === "boolean" ? force : !isOpen;
	sidebar.classList.toggle("is-open", shouldOpen);
	if (state.dom.sidebarToggle) {
		state.dom.sidebarToggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
	}
}

function closeSidebarOnMobile() {
	if (window.matchMedia("(max-width: 768px)").matches) {
		toggleSidebar(false);
	}
}

function getMessagesForChat(chatId) {
	return state.messages
		.filter((message) => message.chatId === chatId)
		.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

function escapeHtml(text) {
	const map = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#039;"
	};
	return text.replace(/[&<>"']/g, (char) => map[char]);
}

function escapeAttribute(value = "") {
	return escapeHtml(value).replace(/"/g, "&quot;");
}

function safeParse(value) {
	if (!value) return null;
	try {
		return JSON.parse(value);
	} catch (error) {
		console.warn("Failed to parse value", error);
		return null;
	}
}

function mergeLocalChatState() {
	const storedChats = loadCollectionFromStorage(STORAGE_KEYS.chats);
	const storedMessages = loadCollectionFromStorage(STORAGE_KEYS.messages);
	state.chats = mergeById(state.chats, storedChats.map(normalizeChat));
	state.messages = mergeById(state.messages, storedMessages.map(normalizeMessage));
}

function loadCollectionFromStorage(key) {
	const value = safeParse(localStorage.getItem(key));
	return Array.isArray(value) ? value : [];
}

function mergeById(base, extras) {
	const map = new Map();
	base.forEach((item) => {
		if (item?.id) {
			map.set(item.id, item);
		}
	});
	extras.forEach((item) => {
		if (item?.id) {
			map.set(item.id, item);
		}
	});
	return Array.from(map.values());
}

function normalizeChat(chat = {}) {
	const createdAt = chat.createdAt || new Date().toISOString();
	return {
		id: chat.id || uniqueId("chat_"),
		title: chat.title || chat.name || "Policy analysis",
		description: chat.description || "",
		createdAt,
		updatedAt: chat.updatedAt || chat.lastMessageAt || createdAt
	};
}

function normalizeMessage(message = {}) {
	return {
		id: message.id || uniqueId("msg_"),
		chatId: message.chatId,
		role: message.role === "assistant" ? "assistant" : "user",
		type: MESSAGE_TYPES.includes(message.type) ? message.type : "text",
		content: message.content || "",
		meta: message.meta || null,
		createdAt: message.createdAt || new Date().toISOString()
	};
}

function normalizeArtifact(artifact = {}) {
	if (!artifact.id) return null;
	return {
		id: artifact.id,
		type: artifact.type || "summary",
		title: artifact.title || "Untitled artifact",
		summary: artifact.summary || "",
		createdAt: artifact.createdAt || Date.now(),
		updatedAt: artifact.updatedAt || Date.now(),
		data: artifact.data ?? null
	};
}

function flattenMessagesFromChats(chats = []) {
	return chats.flatMap((chat) => {
		if (!Array.isArray(chat?.messages)) {
			return [];
		}
		return chat.messages.map((message) => ({ ...message, chatId: chat.id }));
	});
}

function persistChats() {
	try {
		localStorage.setItem(STORAGE_KEYS.chats, JSON.stringify(state.chats));
	} catch (error) {
		console.warn("Failed to persist chats", error);
	}
}

function persistMessages() {
	try {
		localStorage.setItem(STORAGE_KEYS.messages, JSON.stringify(state.messages));
	} catch (error) {
		console.warn("Failed to persist messages", error);
	}
}

function persistArtifacts() {
	try {
		localStorage.setItem(STORAGE_KEYS.artifacts, JSON.stringify(assistantArtifacts));
	} catch (error) {
		console.warn("Failed to persist artifacts", error);
	}
}

function hydrateArtifactsFromStorage() {
	const storedArtifacts = loadCollectionFromStorage(STORAGE_KEYS.artifacts);
	assistantArtifacts.length = 0;
	storedArtifacts.forEach((artifact) => {
		const normalized = normalizeArtifact(artifact);
		if (normalized) {
			assistantArtifacts.push(normalized);
		}
	});
}

function generateAssistantReply(userText) {
	return `I captured your request: "${userText}". I'll outline considerations, next steps, and compliance checks shortly.`;
}

function uniqueId(prefix) {
	return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isComplianceAnalysisIntent(text) {
	if (!text) return false;
	const intents = [
		"start a new compliance analysis",
		"new compliance analysis",
		"analyze a new requirement"
	];
	return intents.some((phrase) => text.includes(phrase));
}

function findMessageById(messageId) {
	return state.messages.find((message) => message.id === messageId) || null;
}

function appendAssistantNotice(chatId, content) {
	const targetChat = state.chats.find((chat) => chat.id === chatId) || null;
	if (!targetChat) return;
	const timestamp = new Date().toISOString();
	const message = {
		id: uniqueId("msg_"),
		chatId,
		role: "assistant",
		type: "text",
		content,
		createdAt: timestamp
	};
	state.messages.push(message);
	persistMessages();
	if (state.currentChatId === chatId) {
		renderChat();
	}
}

function startRequirementAnalysis(formData = {}, chatId) {
	const targetChat = state.chats.find((item) => item.id === (chatId || state.currentChatId));
	if (!targetChat) return;
	const timestamp = new Date().toISOString();
	const recommendations = buildMockRecommendations(formData);
	const highRiskCount = recommendations.filter((rec) => (rec.risk || "").toLowerCase() === "high").length;
	const requirementTitle = formData.title?.trim() || "the requirement";
	const requirementMeta = {
		title: requirementTitle,
		effectiveDate: formData.effectiveDate || null,
		sourceUrl: formData.sourceUrl || null
	};
	const artifactId = createArtifact({
		type: "recommendations",
		title: `Recommendations for ${requirementTitle}`,
		summary: `${recommendations.length} recommendations · ${highRiskCount} high risk`,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		data: { requirementMeta, recommendations }
	});
	const introMessage = {
		id: uniqueId("msg_"),
		chatId: targetChat.id,
		role: "assistant",
		type: "text",
		content: `I've analyzed the new requirement against your existing policy. I found ${recommendations.length} recommendation(s), including ${highRiskCount} high-risk item(s).`,
		createdAt: timestamp
	};
	const artifactLinkMessage = {
		id: uniqueId("msg_"),
		chatId: targetChat.id,
		role: "assistant",
		type: "artifact-link",
		content: `View recommendations for ${requirementTitle}`,
		artifactId,
		createdAt: timestamp
	};
	state.messages.push(introMessage, artifactLinkMessage);
	targetChat.updatedAt = timestamp;
	persistChats();
	persistMessages();
	if (state.currentChatId === targetChat.id) {
		renderChat();
		renderWorkspaceForActiveArtifact();
	}
}

function attachRecommendationInteractions(container, message) {
	const checkboxes = container.querySelectorAll('[data-role="recommendation-select"]');
	const continueButton = container.querySelector('[data-role="recommendations-continue"]');
	const getSelectedIds = () =>
		Array.from(checkboxes)
			.filter((input) => input.checked)
			.map((input) => input.value);
	checkboxes.forEach((checkbox) => {
		checkbox.addEventListener("change", () => {
			checkbox.closest(".recommendation-card")?.classList.toggle("is-selected", checkbox.checked);
		});
	});
	if (continueButton) {
		continueButton.addEventListener("click", () => {
			const selectedIds = getSelectedIds();
			createTasksFromRecommendations(selectedIds, message.chatId, message.id);
		});
	}
}

function attachArtifactLinkInteractions(container, message) {
	const openButton = container.querySelector('[data-role="artifact-open"]');
	if (!openButton) return;
	if (!message.artifactId) {
		openButton.disabled = true;
		return;
	}
	openButton.addEventListener("click", () => {
		const artifact = getArtifactById(message.artifactId);
		if (!artifact) {
			appendAssistantNotice(message.chatId, "This workspace is no longer available. Re-run the workflow to regenerate it.");
			openButton.disabled = true;
			openButton.textContent = "Workspace unavailable";
			return;
		}
		setActiveArtifact(message.artifactId);
	});
}

function attachTaskInteractions(container, message) {
	const mode = message.meta?.mode || "review";
	if (mode === "review") {
		bindTaskReviewInteractions(container, message);
	} else if (mode === "priority") {
		const assignButton = container.querySelector('[data-role="tasks-assign"]');
		if (assignButton) {
			assignButton.addEventListener("click", () => {
				const msg = findMessageById(message.id);
				const tasks = msg?.meta?.tasks || [];
				showAssignmentCard(tasks, message.chatId);
			});
		}
	} else if (mode === "assignment") {
		const finalizeButton = container.querySelector('[data-role="tasks-finalize"]');
		if (finalizeButton) {
			finalizeButton.addEventListener("click", () => {
				const msg = findMessageById(message.id);
				const tasks = (msg?.meta?.tasks || []).map((task) => {
					const card = container.querySelector(`.task-card[data-task-id="${task.id}"]`);
					const assigneeSelect = card?.querySelector('select[name="assignee"]');
					const dueDateInput = card?.querySelector('input[name="dueDate"]');
					return {
						...task,
						assignee: assigneeSelect?.value || task.assignee || "",
						dueDate: dueDateInput?.value || task.dueDate || ""
					};
				});
				finalizeWorkflow(tasks, message.chatId);
			});
		}
	}
}

function bindTaskReviewInteractions(container, message) {
	const messageId = message.id;
	const cards = container.querySelectorAll(".task-card");
	cards.forEach((card) => {
		const taskId = card.dataset.taskId;
		const titleInput = card.querySelector('input[name="title"]');
		const descInput = card.querySelector('textarea[name="description"]');
		const riskSelect = card.querySelector('select[name="risk"]');
		if (titleInput) {
			titleInput.addEventListener("input", () => updateTaskMeta(messageId, taskId, { title: titleInput.value }));
		}
		if (descInput) {
			descInput.addEventListener("input", () => updateTaskMeta(messageId, taskId, { description: descInput.value }));
		}
		if (riskSelect) {
			riskSelect.addEventListener("change", () => updateTaskMeta(messageId, taskId, { risk: riskSelect.value }));
		}
		card.querySelectorAll("[data-action]").forEach((button) => {
			button.addEventListener("click", () => {
				const action = button.dataset.action;
				const statusMap = {
					accept: "accepted",
					reject: "rejected",
					snooze: "snoozed"
				};
				const status = statusMap[action] || "pending";
				updateTaskMeta(messageId, taskId, { status });
				setTaskCardState(card, status);
			});
		});
		setTaskCardState(card, card.dataset.status || "pending");
	});
	const nextButton = container.querySelector('[data-role="tasks-next"]');
	if (nextButton) {
		nextButton.addEventListener("click", () => {
			const msg = findMessageById(messageId);
			const accepted = (msg?.meta?.tasks || []).filter((task) => task.status === "accepted");
			prioritizeTasks(accepted, message.chatId);
		});
	}
}

function setTaskCardState(card, status) {
	card.dataset.status = status;
	card.classList.remove("is-accepted", "is-rejected", "is-snoozed");
	const statusSpan = card.querySelector('[data-role="task-status"]');
	if (statusSpan) {
		statusSpan.textContent = (status || "pending").toUpperCase();
	}
	if (status === "accepted") {
		card.classList.add("is-accepted");
	} else if (status === "rejected") {
		card.classList.add("is-rejected");
	} else if (status === "snoozed") {
		card.classList.add("is-snoozed");
	}
}

function getDragAfterElement(container, y) {
	const items = [...container.querySelectorAll(".workspace-priority-item:not(.is-dragging)")];
	return items.reduce(
		(closest, child) => {
			const box = child.getBoundingClientRect();
			const offset = y - box.top - box.height / 2;
			if (offset < 0 && offset > closest.offset) {
				return { offset, element: child };
			}
			return closest;
		},
		{ offset: Number.NEGATIVE_INFINITY, element: null }
	).element;
}

function createTasksFromRecommendations(selectedIds = [], chatId, sourceMessageId) {
	const targetChat = state.chats.find((item) => item.id === (chatId || state.currentChatId));
	if (!targetChat) return;
	if (!selectedIds.length) {
		appendAssistantNotice(targetChat.id, "Select at least one recommendation to convert into actionable tasks.");
		return;
	}
	const sourceMessage = sourceMessageId ? findMessageById(sourceMessageId) : null;
	const recommendations = sourceMessage?.meta?.recommendations || [];
	const selected = recommendations.filter((rec) => selectedIds.includes(rec.id));
	if (!selected.length) {
		appendAssistantNotice(targetChat.id, "Unable to locate the selected recommendations. Try rerunning the analysis.");
		return;
	}
	const tasks = selected.map((rec, index) => {
		const defaultTitle = rec.description?.split(".")[0]?.trim() || `Task ${index + 1}`;
		return {
			id: uniqueId("task_"),
			title: defaultTitle,
			description: rec.description || "",
			risk: rec.risk || "Medium",
			category: rec.category || "General",
			source: rec.source || null,
			originRecommendationId: rec.id,
			status: "pending"
		};
	});
	const timestamp = new Date().toISOString();
	const intro = {
		id: uniqueId("msg_"),
		chatId: targetChat.id,
		role: "assistant",
		type: "text",
		content: `Converted ${tasks.length} recommendation(s) into tasks. Review, edit, and accept the ones you want to move forward.`,
		createdAt: timestamp
	};
	const taskMessage = {
		id: uniqueId("msg_"),
		chatId: targetChat.id,
		role: "assistant",
		type: "tasks",
		meta: { tasks, mode: "review" },
		content: "",
		createdAt: timestamp
	};
	state.messages.push(intro, taskMessage);
	targetChat.updatedAt = timestamp;
	persistChats();
	persistMessages();
	if (state.currentChatId === targetChat.id) {
		renderChat();
	}
}

function buildMockRecommendations(formData = {}) {
	const title = (formData.title || "the new requirement").trim();
	return [
		{
			id: uniqueId("rec_"),
			description: `Update Section 3 roles and responsibilities to reflect accountability for ${title}.`,
			category: "Policy Update",
			risk: "High",
			effort: "Medium",
			source: {
				title: "City Digital Accessibility Policy",
				section: "3.2 Governance",
				excerpt: "Section 3.2 requires agencies to document owners for each accessibility control.",
				url: "https://example.gov/policies/accessibility#section-3"
			}
		},
		{
			id: uniqueId("rec_"),
			description: `Add an onboarding checklist to ensure new vendors align with ${title}.`,
			category: "Procurement",
			risk: "Medium",
			effort: "Low",
			source: {
				title: "City Digital Accessibility Policy",
				section: "5.1 Procurement",
				excerpt: "Procurement teams must verify digital tools meet WCAG AA prior to deployment.",
				url: "https://example.gov/policies/accessibility#procurement"
			}
		},
		{
			id: uniqueId("rec_"),
			description: `Schedule quarterly accessibility drills to test compliance with ${title}.`,
			category: "Operations",
			risk: "Medium",
			effort: "High",
			source: {
				title: "City Digital Accessibility Policy",
				section: "7.4 Continuous Monitoring",
				excerpt: "Agencies must test high-risk workflows at least quarterly and log remediation steps.",
				url: "https://example.gov/policies/accessibility#monitoring"
			}
		}
	];
}

function buildTasksFromRecommendations(recommendations = []) {
	return recommendations.map((rec, index) => {
		const defaultTitle = rec.description?.split(".")[0]?.trim() || `Task ${index + 1}`;
		return {
			id: uniqueId("task_"),
			title: defaultTitle,
			description: rec.description || "",
			risk: rec.risk || "Medium",
			category: rec.category || "General",
			source: rec.source || null,
			originRecommendationId: rec.id,
			status: "pending"
		};
	});
}

function updateTaskMeta(messageId, taskId, updates) {
	const message = findMessageById(messageId);
	if (!message?.meta?.tasks) return null;
	const task = message.meta.tasks.find((item) => item.id === taskId);
	if (!task) return null;
	Object.assign(task, updates);
	persistMessages();
	return task;
}

function prioritizeTasks(acceptedTasks = [], chatId) {
	const targetChat = state.chats.find((chat) => chat.id === (chatId || state.currentChatId));
	if (!targetChat) return;
	if (!acceptedTasks.length) {
		appendAssistantNotice(targetChat.id, "Accept at least one task before prioritizing.");
		return;
	}
	const prioritized = acceptedTasks.map((task) => ({
		...task,
		priority: derivePriorityFromRisk(task.risk)
	}));
	const timestamp = new Date().toISOString();
	const intro = {
		id: uniqueId("msg_"),
		chatId: targetChat.id,
		role: "assistant",
		type: "text",
		content: "Prioritized accepted tasks based on their risk levels. Review before assignment.",
		createdAt: timestamp
	};
	const card = {
		id: uniqueId("msg_"),
		chatId: targetChat.id,
		role: "assistant",
		type: "tasks",
		meta: { tasks: prioritized, mode: "priority" },
		content: "",
		createdAt: timestamp
	};
	state.messages.push(intro, card);
	targetChat.updatedAt = timestamp;
	persistChats();
	persistMessages();
	if (state.currentChatId === targetChat.id) {
		renderChat();
	}
}

function showAssignmentCard(prioritizedTasks = [], chatId) {
	const targetChat = state.chats.find((chat) => chat.id === (chatId || state.currentChatId));
	if (!targetChat) return;
	if (!prioritizedTasks.length) {
		appendAssistantNotice(targetChat.id, "No tasks ready for assignment yet.");
		return;
	}
	const timestamp = new Date().toISOString();
	const info = {
		id: uniqueId("msg_"),
		chatId: targetChat.id,
		role: "assistant",
		type: "text",
		content: "Assign each prioritized task to an owner and due date.",
		createdAt: timestamp
	};
	const card = {
		id: uniqueId("msg_"),
		chatId: targetChat.id,
		role: "assistant",
		type: "tasks",
		meta: { tasks: prioritizedTasks.map((task) => ({ ...task })), mode: "assignment" },
		content: "",
		createdAt: timestamp
	};
	state.messages.push(info, card);
	targetChat.updatedAt = timestamp;
	persistChats();
	persistMessages();
	if (state.currentChatId === targetChat.id) {
		renderChat();
	}
}

function derivePriorityFromRisk(risk = "") {
	switch ((risk || "").toLowerCase()) {
		case "high":
			return "HIGH";
		case "medium":
			return "MEDIUM";
		default:
			return "LOW";
	}
}

function getPriorityRank(value = "") {
	const upper = (value || "").toUpperCase();
	const index = PRIORITY_LEVELS.indexOf(upper);
	return index === -1 ? PRIORITY_LEVELS.length : index;
}

function summarizePriorityCounts(tasks = []) {
	return tasks.reduce(
		(acc, task) => {
			const key = (task.priority || derivePriorityFromRisk(task.risk || "")).toUpperCase();
			acc[key] = (acc[key] || 0) + 1;
			return acc;
		},
		{ HIGH: 0, MEDIUM: 0, LOW: 0 }
	);
}

function buildPrioritizationSummary(tasks = []) {
	const counts = summarizePriorityCounts(tasks);
	return `${tasks.length} task(s) · ${counts.HIGH} high / ${counts.MEDIUM} medium / ${counts.LOW} low`;
}

function buildAssignmentSummary(tasks = []) {
	const assignedCount = tasks.filter((task) => Boolean(task.assignee && task.assignee !== "Unassigned")).length;
	return `${tasks.length} task(s) · ${assignedCount} assigned`;
}

function buildArtifactSummaryText(artifact) {
	if (!artifact) return "";
	switch (artifact.type) {
		case "recommendations":
			return summarizeRecommendationsArtifact(artifact);
		case "tasks":
			return summarizeTasksArtifact(artifact);
		case "prioritization":
			return summarizePrioritizationArtifact(artifact);
		case "assignments":
			return summarizeAssignmentsArtifact(artifact);
		case "summary":
			return summarizeSummaryArtifact(artifact);
		default:
			return artifact.summary || "";
	}
}

function summarizeRecommendationsArtifact(artifact) {
	const recommendations = Array.isArray(artifact?.data?.recommendations) ? artifact.data.recommendations : [];
	const selectedIds = Array.isArray(artifact?.data?.selectedRecommendationIds) ? artifact.data.selectedRecommendationIds : [];
	if (!recommendations.length) return artifact.summary || "";
	return `${recommendations.length} recommendation(s) · ${selectedIds.length} selected`;
}

function summarizeTasksArtifact(artifact) {
	const tasks = Array.isArray(artifact?.data?.tasks) ? artifact.data.tasks : [];
	if (!tasks.length) return artifact.summary || "";
	const counts = summarizeRiskCounts(tasks);
	return `${tasks.length} task(s) · ${counts.HIGH} high / ${counts.MEDIUM} medium / ${counts.LOW} low`;
}

function summarizePrioritizationArtifact(artifact) {
	const tasks = Array.isArray(artifact?.data?.tasks) ? artifact.data.tasks : [];
	if (!tasks.length) return artifact.summary || "";
	return buildPrioritizationSummary(tasks);
}

function summarizeAssignmentsArtifact(artifact) {
	const tasks = Array.isArray(artifact?.data?.tasks) ? artifact.data.tasks : [];
	if (!tasks.length) return artifact.summary || "";
	return buildAssignmentSummary(tasks);
}

function summarizeSummaryArtifact(artifact) {
	const tasks = Array.isArray(artifact?.data?.tasks) ? artifact.data.tasks : [];
	const counts = artifact?.data?.counts || summarizePriorityCounts(tasks);
	if (!tasks.length) return artifact.summary || "";
	return `${tasks.length} task(s) · ${counts.HIGH || 0} high / ${counts.MEDIUM || 0} medium / ${counts.LOW || 0} low`;
}

function finalizeWorkflow(tasksWithAssignments = [], chatId) {
	const targetChat = state.chats.find((chat) => chat.id === (chatId || state.currentChatId));
	if (!targetChat) return;
	if (!tasksWithAssignments.length) {
		appendAssistantNotice(targetChat.id, "No tasks were captured for summary.");
		return;
	}
	const timestamp = new Date().toISOString();
	const normalizedTasks = tasksWithAssignments.map((task) => ({
		...task,
		assignee: task.assignee || "Unassigned",
		status: task.status || "pending",
		priority: task.priority || derivePriorityFromRisk(task.risk)
	}));
	state.tasks = mergeTasks(state.tasks, normalizedTasks);
	const counts = normalizedTasks.reduce((acc, task) => {
		const key = (task.priority || "LOW").toUpperCase();
		acc[key] = (acc[key] || 0) + 1;
		return acc;
	}, { HIGH: 0, MEDIUM: 0, LOW: 0 });
	const uniqueSources = normalizedTasks
		.map((task) => task.source?.title)
		.filter(Boolean)
		.filter((title, index, arr) => arr.indexOf(title) === index);
	const summaryText = `Created ${normalizedTasks.length} task(s): ${counts.HIGH} high, ${counts.MEDIUM} medium, ${counts.LOW} low priority. Key sources: ${uniqueSources.join(", ") || "n/a"}.`;
	const summaryMessage = {
		id: uniqueId("msg_"),
		chatId: targetChat.id,
		role: "assistant",
		type: "summary",
		content: summaryText,
		meta: { tasks: normalizedTasks },
		createdAt: timestamp
	};
	state.messages.push(summaryMessage);
	targetChat.updatedAt = timestamp;
	persistChats();
	persistMessages();
	if (state.currentChatId === targetChat.id) {
		renderChat();
	}
}

function mergeTasks(existing = [], incoming = []) {
	const map = new Map(existing.map((task) => [task.id, task]));
	incoming.forEach((task) => {
		map.set(task.id, task);
	});
	return Array.from(map.values());
}

function appendAssistantTaskTransitionMessage(taskCount, requirementTitle, artifactId) {
	const chat = getCurrentChat();
	if (!chat) return;
	const timestamp = new Date().toISOString();
	const summaryMessage = {
		id: uniqueId("msg_"),
		chatId: chat.id,
		role: "assistant",
		type: "text",
		content: `Converted ${taskCount} recommendation(s) from ${requirementTitle} into tasks. Open the workspace to review them.`,
		createdAt: timestamp
	};
	const artifactMessage = {
		id: uniqueId("msg_"),
		chatId: chat.id,
		role: "assistant",
		type: "artifact-link",
		content: `Tasks ready for ${requirementTitle}`,
		artifactId,
		createdAt: timestamp
	};
	state.messages.push(summaryMessage, artifactMessage);
	chat.updatedAt = timestamp;
	persistChats();
	persistMessages();
	if (state.currentChatId === chat.id) {
		renderChat();
	}
}

function summarizeRiskCounts(tasks = []) {
	return tasks.reduce(
		(acc, task) => {
			const key = derivePriorityFromRisk(task.risk || "");
			acc[key] = (acc[key] || 0) + 1;
			return acc;
		},
		{ HIGH: 0, MEDIUM: 0, LOW: 0 }
	);
}

function appendAssistantPrioritizationMessage(taskCount, requirementTitle, artifactId) {
	const chat = getCurrentChat();
	if (!chat) return;
	const timestamp = new Date().toISOString();
	const summaryMessage = {
		id: uniqueId("msg_"),
		chatId: chat.id,
		role: "assistant",
		type: "text",
		content: `Ready to prioritize ${taskCount} accepted task(s) for ${requirementTitle}.`,
		createdAt: timestamp
	};
	const artifactMessage = {
		id: uniqueId("msg_"),
		chatId: chat.id,
		role: "assistant",
		type: "artifact-link",
		content: `Prioritize tasks for ${requirementTitle}`,
		artifactId,
		createdAt: timestamp
	};
	state.messages.push(summaryMessage, artifactMessage);
	chat.updatedAt = timestamp;
	persistChats();
	persistMessages();
	if (state.currentChatId === chat.id) {
		renderChat();
	}
}

function appendAssistantAssignmentMessage(taskCount, requirementTitle, artifactId) {
	const chat = getCurrentChat();
	if (!chat) return;
	const timestamp = new Date().toISOString();
	const summaryMessage = {
		id: uniqueId("msg_"),
		chatId: chat.id,
		role: "assistant",
		type: "text",
		content: `Prioritized ${taskCount} task(s). Assign owners to keep momentum for ${requirementTitle}.`,
		createdAt: timestamp
	};
	const artifactMessage = {
		id: uniqueId("msg_"),
		chatId: chat.id,
		role: "assistant",
		type: "artifact-link",
		content: `Assign owners for ${requirementTitle}`,
		artifactId,
		createdAt: timestamp
	};
	state.messages.push(summaryMessage, artifactMessage);
	chat.updatedAt = timestamp;
	persistChats();
	persistMessages();
	if (state.currentChatId === chat.id) {
		renderChat();
	}
}

function appendAssistantSummaryMessage(
	taskCount,
	requirementTitle,
	artifactId,
	counts = { HIGH: 0, MEDIUM: 0, LOW: 0 },
	tasks = [],
	owners = null
) {
	const chat = getCurrentChat();
	if (!chat) return;
	const ownerList = owners && owners.length ? owners : Array.from(new Set(tasks.map((task) => task.assignee).filter(Boolean)));
	const ownerText = ownerList.length ? ownerList.join(", ") : "Unassigned";
	const timestamp = new Date().toISOString();
	const summaryMessage = {
		id: uniqueId("msg_"),
		chatId: chat.id,
		role: "assistant",
		type: "text",
		content: `Created ${taskCount} task(s) for ${requirementTitle}: ${counts.HIGH} high / ${counts.MEDIUM} medium / ${counts.LOW} low. Owners: ${ownerText}.`,
		createdAt: timestamp,
		meta: { tasks }
	};
	const artifactMessage = {
		id: uniqueId("msg_"),
		chatId: chat.id,
		role: "assistant",
		type: "artifact-link",
		content: `Workflow summary for ${requirementTitle}`,
		artifactId,
		createdAt: timestamp
	};
	state.messages.push(summaryMessage, artifactMessage);
	chat.updatedAt = timestamp;
	persistChats();
	persistMessages();
	if (state.currentChatId === chat.id) {
		renderChat();
	}
}

function createArtifact(artifact = {}) {
	const timestamp = Date.now();
	const entry = {
		id: artifact.id || uniqueId("artifact_"),
		type: artifact.type || "summary",
		title: artifact.title || "Untitled artifact",
		summary: artifact.summary || "",
		createdAt: artifact.createdAt || timestamp,
		updatedAt: artifact.updatedAt || timestamp,
		data: artifact.data ?? null
	};
	assistantArtifacts.push(entry);
	persistArtifacts();
	return entry.id;
}

function getArtifactById(id) {
	if (!id) return null;
	return assistantArtifacts.find((artifact) => artifact.id === id) || null;
}

function updateArtifact(artifactId, updater = () => ({})) {
	const artifact = getArtifactById(artifactId);
	if (!artifact) return null;
	const updates = typeof updater === "function" ? updater(artifact) : updater;
	Object.assign(artifact, updates, { updatedAt: Date.now() });
	persistArtifacts();
	renderChat();
	return artifact;
}

function updateWorkspaceTaskStatus(artifactId, taskId, status) {
	updateArtifact(artifactId, (artifact) => {
		const tasks = Array.isArray(artifact.data?.tasks) ? artifact.data.tasks : [];
		const target = tasks.find((task) => task.id === taskId);
		if (target) {
			target.status = status;
		}
		return { data: { ...artifact.data, tasks } };
	});
}

function updateWorkspaceTaskPriority(artifactId, taskId, priority) {
	const normalized = (priority || "").toUpperCase();
	updateArtifact(artifactId, (artifact) => {
		const tasks = Array.isArray(artifact.data?.tasks) ? artifact.data.tasks : [];
		const target = tasks.find((task) => task.id === taskId);
		if (target) {
			target.priority = normalized || target.priority || derivePriorityFromRisk(target.risk || "");
		}
		return {
			summary: buildPrioritizationSummary(tasks),
			data: { ...artifact.data, tasks }
		};
	});
}

function updatePrioritizationOrder(artifactId, orderedIds = []) {
	updateArtifact(artifactId, (artifact) => {
		const tasks = Array.isArray(artifact.data?.tasks) ? [...artifact.data.tasks] : [];
		if (!tasks.length) {
			return { data: artifact.data };
		}
		const idToTask = new Map(tasks.map((task) => [task.id, task]));
		const reordered = orderedIds.map((id) => idToTask.get(id)).filter(Boolean);
		idToTask.forEach((task, id) => {
			if (!orderedIds.includes(id)) {
				reordered.push(task);
			}
		});
		reordered.forEach((task, index) => {
			task.order = index;
		});
		return {
			summary: buildPrioritizationSummary(reordered),
			data: { ...artifact.data, tasks: reordered }
		};
	});
}

function updateAssignmentTaskField(artifactId, taskId, updates = {}) {
	updateArtifact(artifactId, (artifact) => {
		const tasks = Array.isArray(artifact.data?.tasks) ? artifact.data.tasks : [];
		const target = tasks.find((task) => task.id === taskId);
		if (target) {
			Object.assign(target, updates);
		}
		return {
			summary: buildAssignmentSummary(tasks),
			data: { ...artifact.data, tasks }
		};
	});
}

function setActiveArtifact(id) {
	const artifact = id ? getArtifactById(id) : null;
	activeArtifactId = artifact ? artifact.id : null;
	renderWorkspaceForActiveArtifact();
}
