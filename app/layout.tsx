import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"BSTC | Club Portal",description:"Brazilian Soccer Training Center · Registration, families and club management",icons:{icon:"/crest-transparent.png"}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}