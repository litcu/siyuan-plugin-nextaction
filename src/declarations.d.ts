declare module "*.scss";
declare module "*.scss?inline" {
    const content: string;
    export default content;
}
declare module "*.png";
