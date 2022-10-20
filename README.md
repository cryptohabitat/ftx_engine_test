### FTX Test Engine

API and utility to execute in FTX Exchange. This is a test engine developed in late 2020 to connect a
(test) web app in order to allow advanced order execution, as: 

* Chase Orders (limit orders that chase or ammend the price to be as close as last price possible until they are filled)
* Best price (limit orders placed as best bid/ask price possible)
* TWAP orders (already deprecated cause FTX has implemented TWAP orders in their end)

This engine worked as the base reference of functionality to develop a propietary HF execution engines.

As of today, some FTX endpoints had been updated, so I'm not sure it will work. However, it works as a good example of how 
custom orders execution are handled.
