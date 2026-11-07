import { Component } from 'react';
export default class ErrorBoundary extends Component {
 state = { failed: false };
 static getDerivedStateFromError() { return {failed: true}; }
 componentDidCatch(error, info) { console.error('Application failure', error, info); }
 render() { return this.state.failed ? <main role="alert"><h1>Unable to display this page</h1><p>Please reload the page to try again.</p><button onClick={() => window.location.reload()}>Reload</button></main> : this.props.children; }
}
