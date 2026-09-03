import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { Notice } from '../components/ui';
import { useAuth } from '../context/AuthContext';

/**
 * Ingreso.
 *
 * La validacion se hace aqui y no con la del navegador (el formulario lleva
 * noValidate): el globo nativo se dibuja con el valor completo del campo, asi
 * que un autocompletado desmedido tapa la pantalla y no deja ver el formulario.
 * Un mensaje propio siempre ocupa una linea.
 */

/** Un correo institucional no llega ni de lejos a este limite. */
const MAX_EMAIL = 200;
const MAX_PASSWORD = 128;

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const cleanEmail = email.trim();

    if (cleanEmail.length === 0 || password.length === 0) {
      setError('Escriba su correo y su contrasena.');
      return;
    }

    if (!cleanEmail.includes('@') || cleanEmail.length > MAX_EMAIL) {
      setError('Ese no parece un correo valido. Revise el campo y vuelva a intentarlo.');
      return;
    }

    setSubmitting(true);

    try {
      await login(cleanEmail, password);
    } catch (caught) {
      // El servidor responde lo mismo si el correo no existe o si la
      // contrasena es incorrecta; aqui no se afina el mensaje.
      setError(
        caught instanceof ApiError ? caught.message : 'No se pudo iniciar sesion. Intente de nuevo.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={handleSubmit} noValidate>
        <h1 className="login__title">Bandeja Uniremington</h1>
        <p className="login__subtitle">
          Comentarios y mensajes de Instagram y Facebook, en un solo lugar.
        </p>

        {error ? <Notice kind="error">{error}</Notice> : null}

        <div className="field">
          <label htmlFor="email">Correo institucional</label>
          <input
            id="email"
            name="urem-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            maxLength={MAX_EMAIL}
            spellCheck={false}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {email.length > 80 ? (
            <button
              type="button"
              className="link-clear"
              onClick={() => {
                setEmail('');
                setError(null);
              }}
            >
              El campo trae un texto muy largo. Limpiarlo
            </button>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="password">Contrasena</label>
          <input
            id="password"
            name="urem-password"
            type="password"
            autoComplete="current-password"
            maxLength={MAX_PASSWORD}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <button type="submit" className="primary" style={{ width: '100%' }} disabled={submitting}>
          {submitting ? 'Verificando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
