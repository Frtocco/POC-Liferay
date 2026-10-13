// Pantalla de login
// El formulario lo resuelve el widget nativo de Liferay. Este script solo
// cubre un caso: si alguien llega al login con la sesión ya iniciada (por
// ejemplo, entrando a localhost:8080 o volviendo con la flecha de atrás),
// lo manda directo al selector de perfiles.

const section = fragmentElement.querySelector('.nf-login');

// No redirigir mientras se edita o se previsualiza la página: si no, el
// administrador no podría editar el login.
function isEditing() {
	const mode = section.dataset.layoutMode;
	const urlMode = new URLSearchParams(window.location.search).get('p_l_mode');

	return (mode && mode !== 'view') || Boolean(urlMode);
}

if (Liferay.ThemeDisplay.isSignedIn() && !isEditing()) {
	section.classList.add('is-redirecting');

	// replace() en vez de asignar la URL: el login no queda en el historial,
	// así la flecha de atrás no vuelve a esta pantalla.
	window.location.replace(section.dataset.redirect);
}