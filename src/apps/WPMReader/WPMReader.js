import './WPMReader.css';
import React, { useEffect, useRef, useState } from "react";
import { Play, Pause, History } from 'grommet-icons';
import { Main, Button, Box, Header, TextArea, RangeInput, Text, Meter, Footer, CheckBoxGroup } from 'grommet';
import ReactHtmlParser from 'react-html-parser';
import useInterval from '../../shared/hooks/useInterval'
import useEventListener from '@use-it/event-listener'
import { sizes, dummyText } from './constants'

const stickyProgress = {  position: 'sticky', bottom: '0px', opacity: '85%' };

function WPMReader({ toggleTheme }) {
  const [speed, setSpeed] = useState(200);
  const [chunk, setChunk] = useState(1);
  const [textInput, setTextInput] = useState(dummyText);
  const [finalText, setFinalText] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [fontSizeIdx, setFontSizeIdx] = useState(3);
  const [i, setI] = useState(0);
  const wordLength = useRef(0);
  const wordArr = useRef(0);

  const onWPMSpeedChange = event => setSpeed(event.target.value);
  const onChunkSizeChange = event => setChunk(parseInt(event.target.value));
  const onTextInputChange = event => {
    setTextInput(event.target.value);
    setI(0);
  }
  const onFontSizeChange = event => setFontSizeIdx(parseInt(parseInt(event.target.value) - 1));


  const higlightWord = (text, index) => {
    var words = [...wordArr.current];
    if (index >= words.length) {
      return text;
    }
    words.splice(index, 0, "<span class='highlight'>");
    words.splice(index + chunk + 1, 0, "</span>");
    return words.join(' ');
  };

  useEffect(() => {
    wordArr.current = textInput.replace(/(?:\r\n|\r|\n)/g, '<br>').split(" ");
    wordLength.current = wordArr.current.length;
  }, [textInput]); // Only re-run the effect if count changes

  useInterval(function () {
    if (!isPlaying || i > textInput.length || textInput.length === 0)
      return;
    var sentence = higlightWord(textInput, i);

    if (sentence !== textInput) {
      setI(i + chunk);
    }
    setFinalText(sentence)
  }, 60000 / speed * chunk);


  const handleShortcuts = (e) => {
    if (document.activeElement.tagName !== "BODY")
      return

    let keyCode = e.keyCode;
    if (keyCode === 32) {  //space
      setIsPlaying(!isPlaying);
      e.preventDefault();
    }
    if (keyCode === 37) {  //left
      if (speed > 1)
        setSpeed(speed - 1);
      e.preventDefault();
    }
    if (keyCode === 39) {   //right
      setSpeed(speed + 1);
      e.preventDefault();

    }
    if (keyCode === 38) {  //up
      setChunk(chunk + 1)
      e.preventDefault();

    }
    if (keyCode === 40) {   //down
      if (chunk > 1)
        setChunk(chunk - 1)
      e.preventDefault();

    }
    if (keyCode === 82) {  //r
      setI(0)
    }
    if (keyCode === 190) { //>
      setFontSizeIdx((fontSizeIdx + 1) % sizes.length);
      e.preventDefault();
    }

    if (keyCode === 188) { //<
      if (fontSizeIdx === 0) {
        setFontSizeIdx(sizes.length - 1);
      }
      else
        setFontSizeIdx(fontSizeIdx - 1);
      e.preventDefault();
    }
  }

  useEventListener('keydown', handleShortcuts);

  return (
    <>
     <Main>
      <Header background="dark-1" pad="small">
          <Text size="large"> WPM Reader </Text>
          <Button
            label="Toggle Theme"
            primary
            alignSelf="end"
            margin="small"
            size="small"
            onClick={toggleTheme}
          />
      </Header>

      {/* settings box */}
      <Box align="center" pad="large">
        <TextArea value={textInput} onChange={onTextInputChange} />
        <Box direction="row" pad="small" >
          <Box pad="small" align="start" >
            <Text margin={{ vertical: 'medium' }}>WPM: {speed}</Text>
            <RangeInput
              margin={{ vertical: 'medium' }}
              min={1}
              max={1000}
              step={1}
              value={speed} onChange={onWPMSpeedChange} />
          </Box>
          <Box pad="small" align="start">
            <Text margin={{ vertical: 'medium' }}>Chunk: {chunk}</Text>

            <RangeInput
              margin={{ vertical: 'medium' }}
              min={1}
              max={10}
              step={1}
              value={chunk} onChange={onChunkSizeChange} />
          </Box>
          <Box pad="small" align="start">
            <Text margin={{ vertical: 'medium' }}>FontSize: {fontSizeIdx}</Text>

            <RangeInput
              margin={{ vertical: 'medium' }}
              min={1}
              max={sizes.length}
              step={1}
              value={fontSizeIdx} onChange={onFontSizeChange} />
          </Box>
        </Box>

        <Box direction="row">
          <Button
            plain={false} icon={!isPlaying ? <Play /> : <Pause />} hoverIndicator={{
              background: {
                color: 'background-contrast',
              },
              elevation: 'medium',
            }}
            margin="medium"
            alignSelf="center"
            onClick={() => { setIsPlaying(!isPlaying) }}
          />
          <Button
            plain={false} icon={<History />} hoverIndicator
            secondary
            margin="medium"
            alignSelf="center"
            onClick={() => {
              setI(0);
              setFinalText(textInput)
            }}
          />
        </Box>
      </Box>

      {/* reader box */}
      <Box pad="large" >
        {
          <>
            <Text size={sizes[fontSizeIdx]}>
              {ReactHtmlParser(finalText)}
            </Text>
          </>
        }
      </Box>
      </Main>
      <Footer style={stickyProgress} background="light-4" justify="center" pad="small">
        <Text size="xsmall" >{wordLength.current === 0 ? 0 : Math.min(100, parseInt(i * 100 / wordLength.current))} %</Text>
        <Meter size="large" type="bar" value={Math.min(100, (i / wordLength.current) * 100)} />
      </Footer>
    </>
  );
}

export default WPMReader;