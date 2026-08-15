/** CSS Modules: the shared tsdown preset compiles *.module.css into a hashed class map. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
