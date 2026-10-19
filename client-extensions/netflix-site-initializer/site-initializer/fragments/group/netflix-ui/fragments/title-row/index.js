// Fila de títulos
// Busca los contenidos del Content Type "Título" del sitio y muestra los que
// tienen la categoría de género configurada (y opcionalmente la de tipo),
// en orden aleatorio para que la fila cambie en cada carga.
// Liferay inyecta "fragmentElement" (el HTML de este fragment) y
// "configuration" (los valores cargados en el panel de configuración).

const STRUCTURE_NAME = 'Título';

// Referencias de campo configuradas en la estructura
const FIELDS = {
	anio: 'anio',
	clasificacion: 'clasificacion',
	duracion: 'duracion',
	elenco: 'elenco',
	fondo: 'fondo',
	poster: 'poster',
	sinopsis: 'sinopsis',
	temporadas: 'temporadas',
};

const TIPOS = ['pelicula', 'serie'];

const row = fragmentElement.querySelector('.nf-row');
const track = fragmentElement.querySelector('.nf-row__track');
const status = fragmentElement.querySelector('.nf-row__status');
const prevButton = fragmentElement.querySelector('.nf-row__nav--prev');
const nextButton = fragmentElement.querySelector('.nf-row__nav--next');
const dialog = fragmentElement.querySelector('.nf-row__dialog');
const dialogImage = fragmentElement.querySelector('.nf-row__dialog-image');
const dialogTitle = fragmentElement.querySelector('.nf-row__dialog-title');
const dialogMeta = fragmentElement.querySelector('.nf-row__dialog-meta');
const dialogSynopsis = fragmentElement.querySelector('.nf-row__dialog-synopsis');
const closeButton = fragmentElement.querySelector('.nf-row__dialog-close');

const siteId = Liferay.ThemeDisplay.getScopeGroupId();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const dialogId = `nf-row-dialog-${Math.random().toString(36).slice(2, 8)}`;

dialog.id = dialogId;
dialogTitle.id = `${dialogId}-title`;
dialog.setAttribute('aria-labelledby', dialogTitle.id);

// Compara sin mayúsculas ni tildes: "Comedia" = "comedia", "Película" = "pelicula"
function normalize(value) {
	return (value || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

const genero = normalize(configuration.genero);
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

// Mezcla la lista al azar (algoritmo Fisher-Yates): recorre el array de atrás
// hacia adelante e intercambia cada elemento con otro elegido al azar entre
// los que todavía no se movieron. Devuelve una copia y no toca el original.
function shuffle(list) {
	const result = [...list];

	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));

		[result[i], result[j]] = [result[j], result[i]];
	}

	return result;
}

function fieldValues(item, name) {
	return (item.contentFields || [])
		.filter((field) => field.name === name)
		.map((field) => field.contentFieldValue)
		.filter(Boolean);
}

function fieldValue(item, name) {
	return fieldValues(item, name)[0];
}

function fieldText(item, name) {
	const value = fieldValue(item, name);

	return value?.data ? String(value.data).trim() : '';
}

// Las cards son horizontales (16:9), por eso usan el fondo horizontal. Los
// pósters son verticales y "cover" los recorta demasiado; quedan como fallback.
function imageUrl(item) {
	if (normalize(item.title).includes('viaje de chihiro') && row.dataset.chihiroBackdrop) {
		return row.dataset.chihiroBackdrop;
	}

	return (
		fieldValue(item, FIELDS.fondo)?.image?.contentUrl ||
		fieldValue(item, FIELDS.poster)?.image?.contentUrl ||
		''
	);
}

function formatDuration(minutes) {
	const total = parseInt(minutes, 10);

	if (!total) {
		return '';
	}

	const hours = Math.floor(total / 60);
	const rest = total % 60;

	return hours ? `${hours} h ${rest} min` : `${rest} min`;
}

// ---------- Modal de detalle ----------

function addDialogMeta(text, badge = false) {
	if (!text) {
		return;
	}

	const entry = document.createElement('li');

	entry.textContent = text;

	if (badge) {
		entry.className = 'nf-row__dialog-badge';
	}

	dialogMeta.appendChild(entry);
}

function setDialogExtra(field, values) {
	const detail = dialog.querySelector(`.nf-row__dialog-extra[data-field="${field}"]`);

	detail.querySelector('.nf-row__dialog-value').textContent = values.join(', ');
	detail.hidden = !values.length;
}

function renderDialog(item) {
	const names = (item.taxonomyCategoryBriefs || []).map(
		(category) => category.taxonomyCategoryName
	);
	const esSerie = names.some((name) => normalize(name) === 'serie');
	const image = imageUrl(item);

	dialogImage.hidden = !image;

	if (image) {
		dialogImage.src = image;
	}
	else {
		dialogImage.removeAttribute('src');
	}
	dialogTitle.textContent = item.title;
	dialogSynopsis.textContent = fieldText(item, FIELDS.sinopsis);

	dialogMeta.replaceChildren();
	addDialogMeta(fieldText(item, FIELDS.anio));
	addDialogMeta(fieldText(item, FIELDS.clasificacion), true);

	if (esSerie) {
		const temporadas = parseInt(fieldText(item, FIELDS.temporadas), 10);

		addDialogMeta(
			temporadas ? `${temporadas} ${temporadas === 1 ? 'temporada' : 'temporadas'}` : ''
		);
	}
	else {
		addDialogMeta(formatDuration(fieldText(item, FIELDS.duracion)));
	}

	const elenco = fieldValues(item, FIELDS.elenco)
		.map((value) => String(value.data || '').trim())
		.filter(Boolean);
	const generos = names.filter((name) => !TIPOS.includes(normalize(name)));

	setDialogExtra('elenco', elenco);
	setDialogExtra('generos', generos);
}

let dialogOpener = null;

function openDialog(item, opener) {
	dialogOpener = opener;
	renderDialog(item);
	dialog.scrollTop = 0;
	dialog.showModal();
	document.documentElement.classList.add('nf-row-dialog-lock');
	closeButton.focus();
}

closeButton.addEventListener('click', () => dialog.close());

dialog.addEventListener('click', (event) => {
	if (event.target === dialog) {
		dialog.close();
	}
});

dialog.addEventListener('close', () => {
	document.documentElement.classList.remove('nf-row-dialog-lock');
	dialogOpener?.focus();
});

function createElement(tagName, className, text) {
	const element = document.createElement(tagName);

	element.className = className;

	if (text) {
		element.textContent = text;
	}

	return element;
}

// Las cards se arman con createElement (no innerHTML) para no inyectar HTML
// que venga del contenido.
function buildCard(item) {
	const card = createElement('article', 'nf-movie-card');
	card.setAttribute('aria-controls', dialogId);
	card.setAttribute('aria-haspopup', 'dialog');
	card.setAttribute('aria-label', item.title);
	card.setAttribute('role', 'listitem');
	card.tabIndex = 0;

	const poster = createElement('div', 'nf-movie-card__poster');

	const url = imageUrl(item);

	if (url) {
		const image = document.createElement('img');
		image.alt = '';
		image.loading = 'lazy';
		image.src = url;
		poster.appendChild(image);
	}

	const info = createElement('div', 'nf-movie-card__info');

	const title = createElement('h3', '', item.title);
	title.title = item.title;

	// Datos que aparecen en hover / foco: clasificación, año, tipo y géneros
	const names = (item.taxonomyCategoryBriefs || []).map(
		(category) => category.taxonomyCategoryName
	);
	const tipoName = names.find((name) => TIPOS.includes(normalize(name)));
	const generos = names.filter((name) => !TIPOS.includes(normalize(name)));

	const meta = createElement('p', 'nf-movie-card__meta');
	const clasificacion = fieldText(item, FIELDS.clasificacion);

	if (clasificacion) {
		meta.appendChild(createElement('span', 'nf-movie-card__badge', clasificacion));
	}

	meta.append([fieldText(item, FIELDS.anio), tipoName].filter(Boolean).join(' · '));

	const details = createElement('div', 'nf-movie-card__details');
	details.append(meta, createElement('p', 'nf-movie-card__genres', generos.join(' • ')));

	info.append(title, details);
	card.append(poster, info);
	card.addEventListener('click', () => openDialog(item, card));
	card.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			openDialog(item, card);
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
	if (!genero) {
		showStatus('Configurá un género para esta fila.');

		return;
	}

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

		const items = contents.items.filter((item) => {
			const categories = categoryNames(item);

			return categories.includes(genero) && (!tipo || categories.includes(tipo));
		});

		if (!items.length) {
			showStatus(`Todavía no hay títulos con el género "${configuration.genero}".`);

			return;
		}

		track.replaceChildren(...shuffle(items).map(buildCard));
		track.removeAttribute('aria-busy');
		updateNav();
	}
	catch (error) {
		console.error('[Fila de títulos]', error);
		showStatus('No se pudieron cargar los títulos. El detalle está en la consola del navegador.');
	}
}

prevButton.addEventListener('click', () => scrollRow(-1));
nextButton.addEventListener('click', () => scrollRow(1));
track.addEventListener('scroll', updateNav, {passive: true});
window.addEventListener('resize', updateNav);

load();
