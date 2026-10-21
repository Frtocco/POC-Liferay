// Tendencias: Top 10 local de títulos más clickeados durante la pestaña actual.
// sessionStorage sobrevive a F5, pero se reinicia al cerrar la pestaña. Cuando
// exista un backoffice, readPopularity() puede reemplazarse por una API.

const STRUCTURE_NAME = 'Título';
const POSTER_FIELD = 'poster';
const TOP_LIMIT = 10;

const track = fragmentElement.querySelector('.nf-trending__track');
const status = fragmentElement.querySelector('.nf-trending__status');
const prevButton = fragmentElement.querySelector('.nf-trending__nav--prev');
const nextButton = fragmentElement.querySelector('.nf-trending__nav--next');

const siteId = Liferay.ThemeDisplay.getScopeGroupId();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const popularityStorageKey = `nf-title-popularity:v1:${siteId}`;

function normalize(value) {
	return (value || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

const tipo = configuration.tipo === 'todos' ? '' : normalize(configuration.tipo);

async function getJSON(path) {
	const response = await fetch(path, {
		credentials: 'include',
		headers: {
			'Accept': 'application/json',
			'x-csrf-token': Liferay.authToken,
		},
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} al pedir ${path}`);
	}

	return response.json();
}

function showStatus(message) {
	track.replaceChildren();
	track.removeAttribute('aria-busy');
	status.textContent = message;
	status.hidden = false;
}

function categoryNames(item) {
	return (item.taxonomyCategoryBriefs || []).map((category) =>
		normalize(category.taxonomyCategoryName)
	);
}

function titleKey(item) {
	if (item.externalReferenceCode) {
		return `erc:${item.externalReferenceCode}`;
	}

	if (item.id) {
		return `id:${item.id}`;
	}

	return `title:${normalize(item.title)}`;
}

function readPopularity() {
	try {
		const value = JSON.parse(sessionStorage.getItem(popularityStorageKey) || '{}');

		return value && typeof value === 'object' ? value : {};
	}
	catch (error) {
		console.warn('[Tendencias] No se pudo leer el ranking de la sesión.', error);

		return {};
	}
}

function recordClick(item) {
	try {
		const popularity = readPopularity();
		const key = titleKey(item);
		const previous = popularity[key] || {};

		popularity[key] = {
			clicks: (Number(previous.clicks) || 0) + 1,
			lastClick: Date.now(),
		};

		sessionStorage.setItem(popularityStorageKey, JSON.stringify(popularity));
	}
	catch (error) {
		console.warn('[Tendencias] No se pudo guardar el click de la sesión.', error);
	}
}

function posterUrl(item) {
	const field = (item.contentFields || []).find(
		(contentField) => contentField.name === POSTER_FIELD
	);

	return field?.contentFieldValue?.image?.contentUrl || '';
}

function compareByPopularity(popularity) {
	return (left, right) => {
		const leftStats = popularity[titleKey(left)] || {};
		const rightStats = popularity[titleKey(right)] || {};
		const clickDifference = (Number(rightStats.clicks) || 0) - (Number(leftStats.clicks) || 0);

		if (clickDifference) {
			return clickDifference;
		}

		const recentDifference = (Number(rightStats.lastClick) || 0) - (Number(leftStats.lastClick) || 0);

		if (recentDifference) {
			return recentDifference;
		}

		const modifiedDifference = Date.parse(right.dateModified || right.dateCreated || 0) -
			Date.parse(left.dateModified || left.dateCreated || 0);

		if (Number.isFinite(modifiedDifference) && modifiedDifference) {
			return modifiedDifference;
		}

		return String(left.title || '').localeCompare(String(right.title || ''), 'es');
	};
}

function createElement(tagName, className, text) {
	const element = document.createElement(tagName);

	element.className = className;

	if (text !== undefined) {
		element.textContent = text;
	}

	return element;
}

function buildCard(item, index) {
	const rank = index + 1;
	const card = createElement(
		'article',
		`nf-trending-card${rank === 10 ? ' nf-trending-card--double-digit' : ''}`
	);

	card.setAttribute('aria-label', `Puesto ${rank}: ${item.title}`);
	card.setAttribute('role', 'listitem');
	card.tabIndex = 0;

	const rankNumber = createElement('span', 'nf-trending-card__rank', String(rank));
	rankNumber.setAttribute('aria-hidden', 'true');

	const poster = createElement('div', 'nf-trending-card__poster');
	const url = posterUrl(item);

	if (url) {
		const image = document.createElement('img');
		image.alt = '';
		image.loading = 'lazy';
		image.src = url;
		poster.appendChild(image);
	}

	const title = createElement('h3', 'nf-trending-card__title', item.title);

	card.append(rankNumber, poster, title);
	card.addEventListener('click', () => recordClick(item));
	card.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			recordClick(item);
		}
	});

	return card;
}

function updateNav() {
	const maxScroll = track.scrollWidth - track.clientWidth - 1;

	prevButton.disabled = track.scrollLeft <= 0;
	nextButton.disabled = track.scrollLeft >= maxScroll;
}

function scrollRow(direction) {
	track.scrollBy({
		behavior: reduceMotion ? 'auto' : 'smooth',
		left: direction * track.clientWidth * 0.9,
	});
}

async function load() {
	try {
		const structures = await getJSON(
			`/o/headless-delivery/v1.0/sites/${siteId}/content-structures?pageSize=100`
		);

		const structure = structures.items.find(
			(item) => normalize(item.name) === normalize(STRUCTURE_NAME)
		);

		if (!structure) {
			showStatus(`No existe el Content Type "${STRUCTURE_NAME}" en este sitio.`);

			return;
		}

		const contents = await getJSON(
			`/o/headless-delivery/v1.0/content-structures/${structure.id}/structured-contents?pageSize=100`
		);

		const candidates = contents.items.filter(
			(item) => !tipo || categoryNames(item).includes(tipo)
		);

		if (!candidates.length) {
			showStatus('Todavía no hay títulos para construir el ranking.');

			return;
		}

		const popularity = readPopularity();
		const ranking = [...candidates]
			.sort(compareByPopularity(popularity))
			.slice(0, TOP_LIMIT);

		track.replaceChildren(...ranking.map(buildCard));
		track.removeAttribute('aria-busy');
		updateNav();
	}
	catch (error) {
		console.error('[Tendencias]', error);
		showStatus('No se pudieron cargar las tendencias. El detalle está en la consola del navegador.');
	}
}

prevButton.addEventListener('click', () => scrollRow(-1));
nextButton.addEventListener('click', () => scrollRow(1));
track.addEventListener('scroll', updateNav, {passive: true});
window.addEventListener('resize', updateNav);

load();
