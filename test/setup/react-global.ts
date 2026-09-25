// tsx compiles .tsx with the classic JSX runtime (React.createElement), which
// expects a `React` binding in scope. Next normally supplies the automatic
// runtime, but out-of-Next test runs don't — so expose React globally before any
// component module is imported. Import this FIRST in .tsx test files.
import * as React from 'react';

(globalThis as unknown as { React: typeof React }).React = React;
