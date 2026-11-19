import { Component } from 'react';
export default class ErrorBoundary extends Component {
 state = { failed: false };
 static getDerivedStateFromError() { return {failed: true}; }
 componentDidCatch(error, info) { console.error('Application failure', error, info); }
 render() { return this.state.failed ? (
  <main role="alert" className="min-h-dvh flex items-center justify-center p-4 bg-gray-100 dark:bg-gray-900">
   <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg max-w-md w-full text-center space-y-4 border dark:border-gray-700">
    <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Unable to display this page</h1>
    <p className="text-sm text-gray-600 dark:text-gray-300">Please reload the page to try again.</p>
    <button onClick={() => window.location.reload()} className="btn btn-primary w-full">Reload</button>
   </div>
  </main>
 ) : this.props.children; }
}
