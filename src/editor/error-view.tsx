export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ErrorView(props: { readonly error: unknown }) {
  return (
    <p role="alert" className="error">
      {messageOf(props.error)}
    </p>
  );
}
