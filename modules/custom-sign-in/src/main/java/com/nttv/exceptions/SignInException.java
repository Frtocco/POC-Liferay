package com.nttv.exceptions;

import java.util.Collections;
import java.util.List;

import javax.ws.rs.core.Response;

/**
 * Error de registro ya traducido al contrato de la API: status HTTP, código,
 * título y errores por campo.
 *
 * @author lantenni
 */
public class SignInException extends Exception {

	public static SignInException badRequest(String code, String title) {
		return new SignInException(
			Response.Status.BAD_REQUEST, code, title,
			Collections.<FieldError>emptyList());
	}

	public static SignInException conflict(String code, String title) {
		return new SignInException(
			Response.Status.CONFLICT, code, title,
			Collections.<FieldError>emptyList());
	}

	public static SignInException fieldError(
		String field, String code, String message) {

		return validation(
			Collections.singletonList(new FieldError(field, code, message)));
	}

	public static SignInException forbidden(String code, String title) {
		return new SignInException(
			Response.Status.FORBIDDEN, code, title,
			Collections.<FieldError>emptyList());
	}

	public static SignInException internalError() {
		return new SignInException(
			Response.Status.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR",
			"Registration failed", Collections.<FieldError>emptyList());
	}

	public static SignInException validation(List<FieldError> fieldErrors) {
		return new SignInException(
			Response.Status.BAD_REQUEST, "VALIDATION_ERROR",
			"Some fields are invalid", fieldErrors);
	}

	public String getCode() {
		return _code;
	}

	public List<FieldError> getFieldErrors() {
		return _fieldErrors;
	}

	public Response.Status getStatus() {
		return _status;
	}

	public String getTitle() {
		return _title;
	}

	public static class FieldError {

		public FieldError(String field, String code, String message) {
			_field = field;
			_code = code;
			_message = message;
		}

		public String getCode() {
			return _code;
		}

		public String getField() {
			return _field;
		}

		public String getMessage() {
			return _message;
		}

		private final String _code;
		private final String _field;
		private final String _message;

	}

	private SignInException(
		Response.Status status, String code, String title,
		List<FieldError> fieldErrors) {

		super(title);

		_status = status;
		_code = code;
		_title = title;
		_fieldErrors = fieldErrors;
	}

	private final String _code;
	private final List<FieldError> _fieldErrors;
	private final Response.Status _status;
	private final String _title;

}