import React from "react";
import { Grommet } from "grommet";
import { grommet } from "grommet";
import WPMReader from "./apps/WPMReader/WPMReader";
const App = () => {
  const [darkMode, setDarkMode] = React.useState(false);

  const toggleTheme = () => {
    setDarkMode(!darkMode);
  }
  return (
    <Grommet full theme={grommet} themeMode={darkMode ? "dark" : "light"}>
      <WPMReader toggleTheme={toggleTheme}/>
    </Grommet>
  );
};
export default App;