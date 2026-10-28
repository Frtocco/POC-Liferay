// Registro (wizard)
// Cada paso valida sus campos y los vuelca en el objeto `user`, que es
// exactamente el body que espera POST /o/sign-in/v1.0 (contrato UserDTO).
// Las validaciones del cliente son solo de UX: la fuente de verdad es el backend.

(function () {
  var root = fragmentElement.querySelector('.nf-signup');

  if (!root) {
    return;
  }

  var STEPS = ['email', 'name', 'password', 'review'];

  // Paso en el que vive cada campo del contrato, para volver ahí si el
  // backend devuelve un error de ese campo
  var FIELD_STEP = {
    acceptTerms: 'review',
    emailAddress: 'email',
    familyName: 'name',
    givenName: 'name',
    password: 'password'
  };

  var MESSAGES = {
    EMAIL_ALREADY_REGISTERED: 'Ya existe una cuenta con este email.',
    INTERNAL_ERROR: 'No pudimos crear tu cuenta. Probá de nuevo en unos minutos.',
    INVALID_EMAIL: 'Ingresá un email válido.',
    INVALID_NAME: 'El nombre no es válido.',
    MALFORMED_JSON: 'Hubo un problema con los datos enviados. Probá de nuevo.',
    NETWORK: 'No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.',
    PASSWORD_INVALID: 'La contraseña no cumple con la política de seguridad.',
    PASSWORD_MISMATCH: 'Las contraseñas no coinciden.',
    PASSWORD_TOO_SHORT: 'La contraseña es demasiado corta.',
    REGISTRATION_DISABLED: 'El registro de nuevas cuentas no está habilitado en este momento.',
    REQUIRED: 'Este campo es obligatorio.',
    TERMS_NOT_ACCEPTED: 'Tenés que aceptar los términos y condiciones.',
    TOO_MANY_REQUESTS: 'Hiciste demasiados intentos. Esperá un momento y volvé a probar.'
  };

  var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  var config = configuration || {};
  var endpoint = config.registrationEndpoint || '/o/sign-in/v1.0';
  var minPasswordLength = parseInt(config.minPasswordLength, 10) || 8;
  var loginURL = config.loginURL || '/c/portal/login';

  var isEditMode = typeof layoutMode !== 'undefined' && layoutMode === 'edit';

  // Cualquier contexto que no sea la página publicada: page editor, preview,
  // o el preview del editor de fragments (que corre en un iframe y no define
  // layoutMode). Ahí el usuario siempre está logueado como admin.
  var isEditorContext =
    isEditMode ||
    (typeof layoutMode !== 'undefined' && layoutMode !== 'view') ||
    window.self !== window.top;

  // ---------- Objeto que se arma paso a paso ----------

  var user = {
    acceptTerms: false,
    captchaToken: '',
    emailAddress: '',
    familyName: '',
    givenName: '',
    languageId: getLanguageId(),
    password: ''
  };

  var current = 0;
  var submitting = false;

  // ---------- Elementos ----------

  var form = root.querySelector('[data-form]');
  var wizard = root.querySelector('[data-wizard]');
  var steps = root.querySelectorAll('[data-step]');
  var nextButton = root.querySelector('[data-next]');
  var backButton = root.querySelector('[data-back]');
  var progressBar = root.querySelector('[data-progress-bar]');
  var counter = root.querySelector('[data-counter]');
  var alertBox = root.querySelector('[data-alert]');
  var debug = root.querySelector('[data-debug]');
  var result = root.querySelector('[data-result]');
  var loginRow = root.querySelector('[data-login-row]');

  function field(name) {
    return form.querySelector('[name="' + name + '"]');
  }

  // ---------- Configuración inicial ----------

  root.querySelector('[data-login-link]').href = loginURL;

  var termsLink = root.querySelector('[data-terms-link]');

  // Sin URL configurada el link quedaba en "#" y abría la misma página en
  // otra pestaña: en ese caso se muestra como texto plano
  if (config.termsURL) {
    termsLink.href = config.termsURL;
  }
  else {
    var termsText = document.createElement('span');

    termsText.textContent = termsLink.textContent;
    termsLink.replaceWith(termsText);
  }

  root.querySelector('[data-password-hint]').textContent =
    'Mínimo ' + minPasswordLength + ' caracteres.';

  // En modo edición se muestran todos los pasos para poder editar los textos
  if (isEditMode) {
    root.classList.add('is-editing');

    return;
  }

  // Un usuario logueado ve un aviso en lugar del wizard. No se redirige:
  // una redirección automática rompe el editor y el preview, donde siempre
  // hay un admin logueado.
  if (
    !isEditorContext &&
    window.Liferay &&
    Liferay.ThemeDisplay &&
    Liferay.ThemeDisplay.isSignedIn()
  ) {
    showSignedIn();

    return;
  }

  // ---------- Pasos: validar y volcar en `user` ----------

  // Cada función devuelve un mapa { campo: código } con los errores del paso.
  // Si no hay errores, el paso ya escribió sus valores en `user`.

  var collectors = {
    email: function () {
      var emailAddress = field('emailAddress').value.trim().toLowerCase();

      if (!emailAddress) {
        return {emailAddress: 'REQUIRED'};
      }

      if (!EMAIL_REGEX.test(emailAddress)) {
        return {emailAddress: 'INVALID_EMAIL'};
      }

      user.emailAddress = emailAddress;

      return {};
    },

    name: function () {
      var errors = {};
      var givenName = field('givenName').value.trim();
      var familyName = field('familyName').value.trim();

      if (!givenName) {
        errors.givenName = 'REQUIRED';
      }

      if (!familyName) {
        errors.familyName = 'REQUIRED';
      }

      if (isEmpty(errors)) {
        user.givenName = givenName;
        user.familyName = familyName;
      }

      return errors;
    },

    password: function () {
      var errors = {};

      // La contraseña nunca se trimea
      var password = field('password').value;
      var passwordConfirm = field('passwordConfirm').value;

      if (!password) {
        errors.password = 'REQUIRED';
      }
      else if (password.length < minPasswordLength) {
        errors.password = 'PASSWORD_TOO_SHORT';
      }

      if (!errors.password && password !== passwordConfirm) {
        errors.passwordConfirm = 'PASSWORD_MISMATCH';
      }

      if (isEmpty(errors)) {
        user.password = password;
      }

      return errors;
    },

    review: function () {
      if (!user.acceptTerms) {
        return {acceptTerms: 'TERMS_NOT_ACCEPTED'};
      }

      return {};
    }
  };

  // ---------- Navegación ----------

  function goTo(index, focus) {
    current = Math.max(0, Math.min(index, STEPS.length - 1));

    steps.forEach(function (step, i) {
      step.classList.toggle('is-active', i === current);
    });

    var isLast = current === STEPS.length - 1;

    backButton.hidden = current === 0;
    nextButton.textContent = isLast ? 'Crear cuenta' : 'Siguiente';
    progressBar.style.width = ((current + 1) / STEPS.length) * 100 + '%';
    counter.textContent = 'Paso ' + (current + 1) + ' de ' + STEPS.length;

    if (STEPS[current] === 'review') {
      renderSummary();
    }

    renderDebug();

    if (focus !== false) {
      var firstInput = steps[current].querySelector('input');

      if (firstInput) {
        firstInput.focus();
      }
    }
  }

  function next() {
    hideAlert();

    var stepName = STEPS[current];
    var errors = collectors[stepName]();

    clearErrors(steps[current]);

    if (!isEmpty(errors)) {
      showErrors(errors);
      renderDebug();

      return;
    }

    if (current < STEPS.length - 1) {
      goTo(current + 1);
    }
    else {
      submit();
    }
  }

  // Sin <form>: así no interfieren SPA (Senna) ni un form contenedor de la
  // página. "Siguiente" es un botón común y Enter se maneja a mano.
  nextButton.addEventListener('click', function () {
    if (!submitting) {
      next();
    }
  });

  form.addEventListener('keydown', function (event) {
    var target = event.target;

    if (
      event.key === 'Enter' &&
      target.tagName === 'INPUT' &&
      target.type !== 'checkbox'
    ) {
      event.preventDefault();

      if (!submitting) {
        next();
      }
    }
  });

  backButton.addEventListener('click', function () {
    hideAlert();
    goTo(current - 1);
  });

  root.querySelectorAll('[data-goto]').forEach(function (button) {
    button.addEventListener('click', function () {
      goTo(STEPS.indexOf(button.getAttribute('data-goto')));
    });
  });

  // Mostrar / ocultar contraseña
  var toggle = root.querySelector('[data-toggle-password]');

  toggle.addEventListener('click', function () {
    var input = field('password');
    var visible = input.type === 'text';

    input.type = visible ? 'password' : 'text';
    toggle.textContent = visible ? 'Mostrar' : 'Ocultar';
    toggle.setAttribute('aria-pressed', String(!visible));
  });

  // Al corregir un campo se limpia su error
  form.addEventListener('input', function (event) {
    var name = event.target.name;

    if (name) {
      clearFieldError(name);
    }
  });

  // Checkbox manual de términos: un botón que alterna user.acceptTerms.
  // Se vuelca al objeto en el momento, sin esperar a "Crear cuenta".
  var termsCheck = root.querySelector('[data-accept-terms]');

  function setAcceptTerms(checked) {
    user.acceptTerms = checked;
    termsCheck.setAttribute('aria-checked', String(checked));

    if (checked) {
      clearFieldError('acceptTerms');
    }

    renderDebug();
  }

  termsCheck.addEventListener('click', function (event) {
    event.preventDefault();
    event.stopPropagation();

    setAcceptTerms(!user.acceptTerms);
  });

  // Click en el texto también alterna, salvo en el link de términos
  root
    .querySelector('[data-accept-terms-text]')
    .addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        return;
      }

      setAcceptTerms(!user.acceptTerms);
    });

  // ---------- Envío ----------

  function submit() {
    submitting = true;
    setLoading(true);

    user.captchaToken = getCaptchaToken();

    var headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    if (window.Liferay && Liferay.authToken) {
      headers['x-csrf-token'] = Liferay.authToken;
    }

    fetch(endpoint, {
      body: JSON.stringify(user),
      credentials: 'include',
      headers: headers,
      method: 'POST'
    })
      .then(function (response) {
        return response
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            return {data: data, ok: response.ok, status: response.status};
          });
      })
      .then(function (res) {
        if (res.ok) {
          showResult(res.data);
        }
        else {
          handleError(res.status, res.data);
        }
      })
      .catch(function () {
        showAlert(MESSAGES.NETWORK);
      })
      .then(function () {
        submitting = false;
        setLoading(false);
      });
  }

  function handleError(status, data) {
    var code = (data && data.code) || (status === 429 ? 'TOO_MANY_REQUESTS' : 'INTERNAL_ERROR');
    var fieldErrors = (data && data.errors) || [];

    // Errores por campo: volver al primer paso que tenga uno
    if (fieldErrors.length) {
      var errors = {};
      var firstStep = STEPS.length - 1;

      fieldErrors.forEach(function (error) {
        errors[error.field] = error.code;

        var stepIndex = STEPS.indexOf(FIELD_STEP[error.field]);

        if (stepIndex !== -1 && stepIndex < firstStep) {
          firstStep = stepIndex;
        }
      });

      goTo(firstStep, false);
      showErrors(errors);

      return;
    }

    if (code === 'EMAIL_ALREADY_REGISTERED') {
      goTo(STEPS.indexOf('email'), false);
      showErrors({emailAddress: code});
      showAlert(
        MESSAGES[code] + ' <a href="' + escapeAttr(loginURL) + '">Iniciá sesión</a>',
        true
      );

      return;
    }

    showAlert(MESSAGES[code] || MESSAGES.INTERNAL_ERROR);
  }

  function showResult(data) {
    var texts = {
      LOGIN: {
        action: 'Iniciar sesión',
        text: 'Ya podés iniciar sesión con tu email y contraseña.',
        title: '¡Listo, ' + escapeHTML(user.givenName) + '!'
      },
      VERIFY_EMAIL: {
        text:
          'Te enviamos un email a <strong>' + escapeHTML(data.emailAddress || user.emailAddress) +
          '</strong>. Abrí el link para activar tu cuenta.',
        title: 'Revisá tu email'
      },
      WAIT_APPROVAL: {
        text: 'Tu cuenta quedó pendiente de aprobación. Te avisamos por email cuando esté activa.',
        title: 'Cuenta creada'
      }
    };

    var content = texts[data.nextStep] || texts.LOGIN;

    // La contraseña no queda en memoria una vez creada la cuenta
    user.password = '';
    form.querySelectorAll('input').forEach(function (input) {
      input.value = '';
    });

    termsCheck.setAttribute('aria-checked', 'false');

    wizard.hidden = true;
    loginRow.hidden = true;
    result.hidden = false;

    result.querySelector('[data-result-title]').innerHTML = content.title;
    result.querySelector('[data-result-text]').innerHTML = content.text;

    var action = result.querySelector('[data-result-action]');

    if (content.action) {
      action.hidden = false;
      action.textContent = content.action;
      action.href = config.successURL || loginURL;
    }

    result.focus();
  }

  function showSignedIn() {
    wizard.hidden = true;
    loginRow.hidden = true;
    result.hidden = false;

    result.querySelector('[data-result-title]').textContent =
      'Ya iniciaste sesión';
    result.querySelector('[data-result-text]').textContent =
      'Tu cuenta ya está activa en este dispositivo.';

    var action = result.querySelector('[data-result-action]');

    action.hidden = false;
    action.textContent = 'Ir al inicio';
    action.href = config.successURL || '/';
  }

  // ---------- Errores y alertas ----------

  function showErrors(errors) {
    var firstInvalid = null;

    Object.keys(errors).forEach(function (name) {
      var message = root.querySelector('[data-error-for="' + name + '"]');
      var input = field(name);

      if (message) {
        message.textContent = MESSAGES[errors[name]] || MESSAGES.REQUIRED;
        message.hidden = false;
      }

      if (input && input.classList) {
        input.classList.add('is-invalid');
        input.setAttribute('aria-invalid', 'true');

        if (message) {
          message.id = message.id || root.id + '-error-' + name;
          input.setAttribute('aria-describedby', message.id);
        }

        firstInvalid = firstInvalid || input;
      }
    });

    if (firstInvalid) {
      firstInvalid.focus();
    }
  }

  function clearFieldError(name) {
    var message = root.querySelector('[data-error-for="' + name + '"]');
    var input = field(name);

    if (message) {
      message.hidden = true;
      message.textContent = '';
    }

    if (input && input.classList) {
      input.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
    }
  }

  function clearErrors(container) {
    container.querySelectorAll('[data-error-for]').forEach(function (message) {
      clearFieldError(message.getAttribute('data-error-for'));
    });
  }

  function showAlert(html, isHTML) {
    if (isHTML) {
      alertBox.innerHTML = html;
    }
    else {
      alertBox.textContent = html;
    }

    alertBox.hidden = false;
  }

  function hideAlert() {
    alertBox.hidden = true;
    alertBox.textContent = '';
  }

  function setLoading(loading) {
    nextButton.disabled = loading;
    backButton.disabled = loading;
    nextButton.classList.toggle('is-loading', loading);
    nextButton.textContent = loading
      ? 'Creando cuenta…'
      : current === STEPS.length - 1 ? 'Crear cuenta' : 'Siguiente';
  }

  // ---------- Resumen y debug ----------

  function renderSummary() {
    root.querySelector('[data-summary="emailAddress"]').textContent = user.emailAddress;
    root.querySelector('[data-summary="fullName"]').textContent =
      user.givenName + ' ' + user.familyName;
    root.querySelector('[data-summary="password"]').textContent =
      user.password.replace(/./g, '•');
  }

  // Muestra el objeto que se va armando (contraseña enmascarada).
  // Se activa desde la configuración del fragment; apagarlo en producción.
  function renderDebug() {
    if (!config.showDebug) {
      return;
    }

    var preview = Object.assign({}, user, {
      password: user.password ? '***' : ''
    });

    debug.hidden = false;
    debug.textContent = JSON.stringify(preview, null, 2);
  }

  // ---------- Utilidades ----------

  function getLanguageId() {
    if (window.Liferay && Liferay.ThemeDisplay) {
      return Liferay.ThemeDisplay.getLanguageId();
    }

    return 'es_AR';
  }

  // TODO: reemplazar por el token real del widget (Turnstile/reCAPTCHA)
  // cuando se implemente la verificación en el backend
  function getCaptchaToken() {
    return config.captchaTestToken || '';
  }

  function isEmpty(object) {
    return Object.keys(object).length === 0;
  }

  function escapeHTML(value) {
    var div = document.createElement('div');

    div.textContent = value == null ? '' : String(value);

    return div.innerHTML;
  }

  function escapeAttr(value) {
    return escapeHTML(value).replace(/"/g, '&quot;');
  }

  goTo(0, false);
})();