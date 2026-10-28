import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

export default defineNuxtPlugin(() => {
  console.log(
    "%c{{}} Developed by https://macmillan.studio",
    "background: black; color: white; padding: 16px 24px; line-height: 1.4",
  );

  gsap.registerPlugin(CustomEase);
  // Example easing, available as ease: "ms-ease". Adjust per project.
  CustomEase.create("ms-ease", "0.22, 1, 0.36, 1");

  gsap.defaults({
    duration: 0.8,
    ease: "ms-ease",
  })

  // Optional font check: requires the font's @font-face CSS to be installed.
  // Do not await this from the plugin or block the whole application on fonts.
  // Customize these callbacks to update your own UI or application state.
  // const onFontsLoaded = () => {
  //   // The requested font face has loaded; run font-dependent work here.
  // };
  // const onFontFallback = (error: unknown) => {
  //   // Continue with fallback fonts on failure, missing registration, or timeout.
  //   console.warn("Font loading did not complete", error);
  // };
  // const checkFonts = async () => {
  //   let timer: ReturnType<typeof setTimeout> | undefined;
  //   try {
  //     const faces = await Promise.race([
  //       document.fonts.load('500 1em "Helvetica Now Display"'),
  //       new Promise<never>((_, reject) => {
  //         timer = setTimeout(() => reject(new Error("Font loading timed out")), 3000);
  //       }),
  //     ]);
  //     if (faces.length === 0) throw new Error("Font face is not registered");
  //     onFontsLoaded();
  //   } catch (error) {
  //     onFontFallback(error);
  //   } finally {
  //     if (timer !== undefined) clearTimeout(timer);
  //   }
  // };
  // void checkFonts();
});
