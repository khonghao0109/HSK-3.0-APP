export interface BootstrapFailureDependencies {
  error(message: string): void;
  exit(code: number): void;
}

const defaultDependencies: BootstrapFailureDependencies = {
  error: (message: string) => console.error(message),
  exit: (code: number) => process.exit(code),
};

/**
 * Fail closed without passing an untrusted bootstrap error to a logger.
 *
 * Configuration validators can attach the rejected environment object to an
 * enumerable `_original` property. Logging that error (or its `details`) would
 * therefore disclose both encoded and decoded credential material.
 */
export function handleBootstrapFailure(
  error: unknown,
  dependencies: BootstrapFailureDependencies = defaultDependencies,
): void {
  // Deliberately acknowledge, but never inspect, serialize, or log the error.
  void error;
  dependencies.error('Application failed to start.');
  dependencies.exit(1);
}
