export const metadata = { title: "ESPN Event Posters", description: "Portrait sports posters for ESPN scoreboards, leaderboards, tournaments and combat events." };

export default function RootLayout({ children }) {
  return <html lang="en"><body style={{margin:0,background:"#06111e",color:"#fff",fontFamily:"Arial,Helvetica,sans-serif"}}>{children}</body></html>;
}
