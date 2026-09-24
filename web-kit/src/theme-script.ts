/** Script inline para aplicar o tema salvo antes da renderização (evita piscar). Seguro para Server Components. */
export const THEME_BOOTSTRAP_SCRIPT = `try{var t=localStorage.getItem('lj-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}`;
