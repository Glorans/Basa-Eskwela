/** Minimal location state for component tests; actual navigation is also exercised in the browser harness. */
export function searchParamsRouter(link = 'link') {
  let params = new URLSearchParams();
  return {
    navigate(search: string) { params = new URLSearchParams(search); },
    search() { return params.toString(); },
    module: {
      Link: link,
      useSearchParams: () => [params, (next: URLSearchParams | ((current: URLSearchParams) => URLSearchParams)) => {
        params = typeof next === 'function' ? next(params) : next;
      }],
    },
  };
}
