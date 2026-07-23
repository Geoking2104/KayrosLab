import { Component } from 'react';
import { I18nContext } from '../i18n/I18nContext.jsx';

export default class ErrorBoundary extends Component {
  static contextType = I18nContext;

  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack || '');
  }

  render() {
    if (this.state.hasError) {
      const { t } = this.context;
      return (
        <div className="error-boundary">
          <div className="error-icon">⚠️</div>
          <h3>{t('app.error.title')}</h3>
          <p className="error-message">{this.state.error?.message || t('app.error.unknown')}</p>
          <button className="btn btn-outline" onClick={() => this.setState({ hasError: false, error: null })}>
            {t('app.error.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
