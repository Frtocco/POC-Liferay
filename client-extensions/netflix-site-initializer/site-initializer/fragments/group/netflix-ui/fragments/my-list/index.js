// Mi lista
// Muestra los títulos que guardó el perfil activo (Object MiListaItem), del
// último agregado al primero. Cada card abre el mismo modal de detalle que la
// fila de títulos, con el botón para quitarlo de la lista.
// Liferay inyecta "fragmentElement" y "configuration".

// Referencias de campo configuradas en la estructura "Título"
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

const section = fragmentElement.querySelector('.nf-mylist');
const heading = fragmentElement.querySelector('.nf-mylist__title');
const grid = fragmentElement.querySelector('.nf-mylist__grid');
const empty = fragmentElement.querySelector('.nf-mylist__empty');
const status = fragmentElement.querySelector('.nf-mylist__status');
const dialog = fragmentElement.querySelector('.nf-mylist__dialog');
const dialogImage = fragmentElement.querySelector('.nf-mylist__dialog-image');
const dialogTitle = fragmentElement.querySelector('.nf-mylist__dialog-title');
const dialogMeta = fragmentElement.querySelector('.nf-mylist__dialog-meta');
const dialogSynopsis = fragmentElement.querySelector('.nf-mylist__dialog-synopsis');
const closeButton = fragmentElement.querySelector('.nf-mylist__dialog-close');

const editing = section.dataset.layoutMode === 'edit';
const dialogId = `nf-mylist-dialog-${Math.random().toString(36).slice(2, 8)}`;

dialog.id = dialogId;
dialogTitle.id = `${dialogId}-title`;
dialog.setAttribute('aria-labelledby', dialogTitle.id);

// ---------- Utilidades ----------

function normalize(value) {
	return (value || '')
		.trim()
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '');
}

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

function categories(item) {
	return (item.taxonomyCategoryBriefs || []).map(
		(category) => category.taxonomyCategoryName
	);
}

// Igual que en la fila: fondo horizontal, póster como fallback y la corrección
// de Chihiro (el recurso tiene que estar en la misma colección de fragments)
function imageUrl(item) {
	if (normalize(item.title).includes('viaje de chihiro') && section.dataset.chihiroBackdrop) {
		return section.dataset.chihiroBackdrop;
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

function createElement(tagName, className, text) {
	const element = document.createElement(tagName);

	element.className = className;

	if (text) {
		element.textContent = text;
	}

	return element;
}

function showStatus(message) {
	grid.hidden = true;
	grid.removeAttribute('aria-busy');
	empty.hidden = true;
	status.textContent = message;
	status.hidden = false;
}

// ---------- Mi lista (bloque compartido) ----------
// Este bloque es IGUAL en Título destacado, Fila de títulos y Mi lista: si lo
// cambiás en uno, copialo en los otros dos. El primer fragment que corre lo
// publica en window.NetflixMiLista y los demás lo reusan, así todos los
// fragments de la página comparten una sola copia de la lista en memoria y se
// enteran de los cambios con el evento "nf-mi-lista-change".

// Ruta del Object y nombre del campo de la relación Perfil → MiListaItem.
// Se confirman en /o/api → c/milistaitems (POST, schema del body).
const MI_LISTA_API = '/o/c/milistaitems';
const MI_LISTA_RELATION = 'r_miLista_c_perfilId';
const ACTIVE_PROFILE_KEY = 'nf-perfil-activo';
const MI_LISTA_EVENT = 'nf-mi-lista-change';

function createMiLista() {
	// {perfilId, promise} — la promesa resuelve a [{entryId, tituloId}],
	// del más nuevo al más viejo
	let cache = null;

	function perfil() {
		try {
			const value = JSON.parse(sessionStorage.getItem(ACTIVE_PROFILE_KEY) || 'null');

			return value && value.id ? value : null;
		}
		catch (error) {
			return null;
		}
	}

	async function request(path, {body, method = 'GET'} = {}) {
		const response = await fetch(path, {
			body: body ? JSON.stringify(body) : undefined,
			credentials: 'include',
			headers: {
				'Accept': 'application/json',
				'Content-Type': 'application/json',
				'x-csrf-token': Liferay.authToken,
			},
			method,
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status} en ${method} ${path}`);
		}

		// DELETE responde 204 sin cuerpo
		return response.status === 204 ? null : response.json();
	}

	function entries() {
		const current = perfil();

		if (!current || !Liferay.ThemeDisplay.isSignedIn()) {
			return Promise.resolve([]);
		}

		// Se pide una sola vez por perfil; si cambia el perfil activo, se recarga
		if (!cache || cache.perfilId !== current.id) {
			const filter = encodeURIComponent(`${MI_LISTA_RELATION} eq '${current.id}'`);
			const promise = request(
				`${MI_LISTA_API}?filter=${filter}&pageSize=500&sort=dateCreated:desc`
			).then((data) =>
				(data.items || []).map((entry) => ({
					entryId: entry.id,
					tituloId: String(entry.tituloId),
				}))
			);

			cache = {perfilId: current.id, promise};

			// Si falla, el próximo pedido vuelve a intentar
			promise.catch(() => {
				if (cache?.promise === promise) {
					cache = null;
				}
			});
		}

		return cache.promise;
	}

	async function has(tituloId) {
		const list = await entries();

		return list.some((entry) => entry.tituloId === String(tituloId));
	}

	function notify(tituloId, added) {
		document.dispatchEvent(
			new CustomEvent(MI_LISTA_EVENT, {detail: {added, tituloId: String(tituloId)}})
		);
	}

	async function add(tituloId) {
		const current = perfil();

		if (!current) {
			throw new Error('No hay un perfil activo.');
		}

		const list = await entries();

		if (list.some((entry) => entry.tituloId === String(tituloId))) {
			return;
		}

		const entry = await request(`${MI_LISTA_API}/`, {
			body: {
				[MI_LISTA_RELATION]: Number(current.id),
				tituloId: Number(tituloId),
			},
			method: 'POST',
		});

		// La lista en memoria se actualiza en el lugar: el más nuevo va primero
		list.unshift({entryId: entry.id, tituloId: String(tituloId)});
		notify(tituloId, true);
	}

	async function remove(tituloId) {
		const list = await entries();
		const matches = list.filter((entry) => entry.tituloId === String(tituloId));

		await Promise.all(
			matches.map((entry) =>
				request(`${MI_LISTA_API}/${entry.entryId}`, {method: 'DELETE'})
			)
		);

		matches.forEach((entry) => list.splice(list.indexOf(entry), 1));
		notify(tituloId, false);
	}

	// Devuelve true si quedó agregado, false si quedó quitado
	async function toggle(tituloId) {
		if (await has(tituloId)) {
			await remove(tituloId);

			return false;
		}

		await add(tituloId);

		return true;
	}

	return {add, entries, has, perfil, remove, toggle, version: 1};
}

const miLista = window.NetflixMiLista || (window.NetflixMiLista = createMiLista());

// Arma el botón "Mi lista" de un modal. "block" es el prefijo de clases del
// fragment (nf-hero, nf-row, nf-mylist). El HTML del botón es fijo: el título
// del contenido nunca pasa por innerHTML.
function createListButton(block) {
	const wrapper = document.createElement('div');

	wrapper.className = `${block}__dialog-actions`;
	wrapper.hidden = true;

	const button = document.createElement('button');

	button.className = `${block}__list-button`;
	button.type = 'button';
	button.setAttribute('aria-label', 'Mi lista');
	button.setAttribute('aria-pressed', 'false');
	button.innerHTML = `
		<svg aria-hidden="true" class="${block}__list-icon ${block}__list-icon--plus" viewBox="0 0 24 24">
			<path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2.5" />
		</svg>
		<svg aria-hidden="true" class="${block}__list-icon ${block}__list-icon--check" viewBox="0 0 24 24">
			<path d="M4.5 12.5l5 5 10-11" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" />
		</svg>
		<span class="${block}__list-label">Mi lista</span>`;

	const message = document.createElement('p');

	message.className = `${block}__list-message`;
	message.setAttribute('role', 'status');

	wrapper.append(button, message);

	const label = button.querySelector(`.${block}__list-label`);

	let tituloId = null;
	let busy = false;

	function render(added) {
		button.setAttribute('aria-pressed', String(added));
		button.title = added ? 'Quitar de Mi lista' : 'Agregar a Mi lista';
		label.textContent = added ? 'En mi lista' : 'Mi lista';
	}

	// Se llama cada vez que se abre el modal con un título
	async function sync(id) {
		const current = String(id);

		tituloId = current;
		message.textContent = '';

		// Sin sesión o sin perfil elegido no hay lista a la que agregar
		wrapper.hidden = !Liferay.ThemeDisplay.isSignedIn() || !miLista.perfil();

		if (wrapper.hidden) {
			return;
		}

		render(false);
		busy = true;
		button.setAttribute('aria-busy', 'true');

		try {
			const added = await miLista.has(current);

			// Si mientras tanto se abrió otro título, esta respuesta ya no sirve
			if (tituloId === current) {
				render(added);
			}
		}
		catch (error) {
			console.error('[Mi lista]', error);

			if (tituloId === current) {
				message.textContent = 'No se pudo cargar Mi lista.';
			}
		}
		finally {
			if (tituloId === current) {
				busy = false;
				button.removeAttribute('aria-busy');
			}
		}
	}

	// No se usa "disabled" para que el foco no se pierda dentro del modal
	button.addEventListener('click', async () => {
		if (busy || !tituloId) {
			return;
		}

		const current = tituloId;

		busy = true;
		button.setAttribute('aria-busy', 'true');
		message.textContent = '';

		try {
			const added = await miLista.toggle(current);

			if (tituloId === current) {
				render(added);
			}
		}
		catch (error) {
			console.error('[Mi lista]', error);
			message.textContent = 'No se pudo actualizar Mi lista. Probá de nuevo.';
		}
		finally {
			busy = false;
			button.removeAttribute('aria-busy');
		}
	});

	// Si otro fragment de la página cambia este mismo título, el botón se entera
	document.addEventListener(MI_LISTA_EVENT, (event) => {
		if (wrapper.isConnected && event.detail.tituloId === tituloId) {
			render(event.detail.added);
		}
	});

	return {sync, wrapper};
}

// ---------- Modal de detalle ----------

const listButton = createListButton('nf-mylist');

dialog.querySelector('.nf-mylist__dialog-body').prepend(listButton.wrapper);

function addDialogMeta(text, badge = false) {
	if (!text) {
		return;
	}

	const entry = document.createElement('li');

	entry.textContent = text;

	if (badge) {
		entry.className = 'nf-mylist__dialog-badge';
	}

	dialogMeta.appendChild(entry);
}

function setDialogExtra(field, values) {
	const detail = dialog.querySelector(`.nf-mylist__dialog-extra[data-field="${field}"]`);

	detail.querySelector('.nf-mylist__dialog-value').textContent = values.join(', ');
	detail.hidden = !values.length;
}

function renderDialog(item) {
	const names = categories(item);
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

	setDialogExtra('elenco', elenco);
	setDialogExtra('generos', names.filter((name) => !TIPOS.includes(normalize(name))));
}

// Id del título abierto, para devolver el foco a su card al cerrar
let openTituloId = null;

function openDialog(item) {
	openTituloId = String(item.id);
	renderDialog(item);
	listButton.sync(item.id);
	dialog.scrollTop = 0;
	dialog.showModal();
	document.documentElement.classList.add('nf-mylist-dialog-lock');
	closeButton.focus();
}

closeButton.addEventListener('click', () => dialog.close());

dialog.addEventListener('click', (event) => {
	if (event.target === dialog) {
		dialog.close();
	}
});

// Si el título se quitó con el modal abierto, su card ya no está: el foco va
// a la primera card o, si la lista quedó vacía, al título de la página
dialog.addEventListener('close', () => {
	document.documentElement.classList.remove('nf-mylist-dialog-lock');

	const target =
		grid.querySelector(`[data-titulo-id="${openTituloId}"]`) ||
		grid.querySelector('.nf-movie-card:not(.nf-movie-card--skeleton)') ||
		heading;

	target.focus();
});

// ---------- Cards ----------

function buildCard(item) {
	const card = createElement('article', 'nf-movie-card');

	card.dataset.tituloId = String(item.id);
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

	const names = categories(item);
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

	card.addEventListener('click', () => openDialog(item));
	card.addEventListener('keydown', (event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			openDialog(item);
		}
	});

	return card;
}

// ---------- Carga ----------

// Los títulos ya pedidos se guardan para no volver a pedirlos al re-renderizar
const titles = new Map();

function fetchTitle(tituloId) {
	if (!titles.has(tituloId)) {
		const promise = getJSON(`/o/headless-delivery/v1.0/structured-contents/${tituloId}`);

		titles.set(tituloId, promise);
		promise.catch(() => titles.delete(tituloId));
	}

	return titles.get(tituloId);
}

// Si se agrega o quita algo mientras otra carga está en curso, solo se
// dibuja la respuesta más reciente
let renderId = 0;

async function render() {
	const current = ++renderId;

	try {
		const entries = await miLista.entries();
		const results = await Promise.allSettled(
			entries.map((entry) => fetchTitle(entry.tituloId))
		);

		if (current !== renderId) {
			return;
		}

		// Un título borrado o despublicado da 404: se saltea y sigue
		results.forEach((result, index) => {
			if (result.status === 'rejected') {
				console.warn(
					`[Mi lista] No se pudo cargar el título ${entries[index].tituloId}.`,
					result.reason
				);
			}
		});

		const items = results
			.filter((result) => result.status === 'fulfilled')
			.map((result) => result.value);

		status.hidden = true;
		grid.removeAttribute('aria-busy');

		if (!items.length) {
			grid.replaceChildren();
			grid.hidden = true;
			empty.hidden = false;

			return;
		}

		grid.replaceChildren(...items.map(buildCard));
		grid.hidden = false;
		empty.hidden = true;
	}
	catch (error) {
		console.error('[Mi lista]', error);
		showStatus('No se pudo cargar tu lista. El detalle está en la consola del navegador.');
	}
}

// Agregar o quitar desde el modal (o desde otro fragment) vuelve a dibujar
document.addEventListener(MI_LISTA_EVENT, () => {
	if (fragmentElement.isConnected) {
		render();
	}
});

if (!Liferay.ThemeDisplay.isSignedIn() || !miLista.perfil()) {
	if (editing) {
		showStatus('Vista previa: la lista se carga con el perfil activo del usuario.');
	}
	else {
		window.location.replace(section.dataset.perfilesPath);
	}
}
else {
	render();
}
