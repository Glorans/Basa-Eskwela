/** Minimal location state for component tests; actual navigation is also exercised in the browser harness. */
export function searchParamsRouter(link = 'link') {
  let params = new URLSearchParams();
  return {
    navigate(search: string) { params = new URLSearchParams(search); },
    search() { return params.toString(); },
    module: {
      Link: link,
      // M7 redesign: User Management reads navigation state (Back to Platform Analytics).
      useLocation: () => ({ state: null, key: 'default', search: `?${params}` }),
      useNavigate: () => (to: string | number) => { if (typeof to === 'string') params = new URLSearchParams(to.split('?')[1] ?? ''); },
      useSearchParams: () => [params, (next: URLSearchParams | ((current: URLSearchParams) => URLSearchParams)) => {
        params = typeof next === 'function' ? next(params) : next;
      }],
    },
  };
}
