// Fila de títulos
// Busca los contenidos del Content Type "Título" del sitio y muestra los que
// tienen la categoría de género configurada (y opcionalmente la de tipo),
// en orden aleatorio para que la fila cambie en cada carga.
// Liferay inyecta "fragmentElement" (el HTML de este fragment) y
// "configuration" (los valores cargados en el panel de configuración).

const STRUCTURE_NAME = 'Título';
const POSTER_FIELD = 'poster';

const track = fragmentElement.querySelector('.nf-row__track');
const status = fragmentElement.querySelector('.nf-row__status');
const prevButton = fragmentElement.querySelector('.nf-row__nav--prev');
const nextButton = fragmentElement.querySelector('.nf-row__nav--next');

const siteId = Liferay.ThemeDisplay.getScopeGroupId();
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

function posterUrl(item) {
	const field = (item.contentFields || []).find(
		(contentField) => contentField.name === POSTER_FIELD
	);

	return field?.contentFieldValue?.image?.contentUrl || '';
}

// Las cards se arman con createElement (no innerHTML) para no inyectar HTML
// que venga del contenido.
function buildCard(item) {
	const card = document.createElement('article');
	card.className = 'nf-movie-card';
	card.setAttribute('role', 'listitem');

	const poster = document.createElement('div');
	poster.className = 'nf-movie-card__poster';

	const url = posterUrl(item);

	if (url) {
		const image = document.createElement('img');
		image.alt = item.title;
		image.loading = 'lazy';
		image.src = url;
		poster.appendChild(image);
	}

	const info = document.createElement('div');
	info.className = 'nf-movie-card__info';

	const title = document.createElement('h3');
	title.textContent = item.title;
	title.title = item.title;

	info.appendChild(title);
	card.append(poster, info);

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